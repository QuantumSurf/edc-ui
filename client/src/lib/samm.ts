// SAMM (Semantic Aspect Meta Model) 구조 파서.
//
// 시맨틱 모델 상세 화면에서 TTL/RDF 본문을 "구조 트리"로 시각화하기 위한 경량 파서.
// 외부 의존성 없이 Turtle의 SAMM 사용 부분집합만 해석한다(전체 RDF 스펙 비목표).
// 어떤 이유로든 실패하면 null/빈 결과를 반환 → 호출부는 원문(TTL)으로 폴백한다.
//
// SAMM 버전(2.x) 및 구명칭 BAMM을 흡수하기 위해, predicate/type 매칭은
// IRI 의 "#" 뒤 local name(프래그먼트) 기준으로 수행한다.

/* ─── Turtle term & triple ───────────────────────────────────── */
type Term =
  | { t: "iri"; v: string }
  | { t: "blank"; v: string }
  | { t: "lit"; v: string; lang?: string; dt?: string };

interface Triple {
  s: Term;
  p: Term;
  o: Term;
}

/* ─── Tokenizer ──────────────────────────────────────────────── */
type Tok =
  | { k: "punc"; v: "." | ";" | "," | "[" | "]" | "(" | ")" }
  | { k: "a" }
  | { k: "iri"; v: string } // resolved absolute IRI
  | { k: "pname"; prefix: string; local: string }
  | { k: "blank"; v: string } // _:label
  | {
      k: "lit";
      v: string;
      lang?: string;
      dtPrefix?: string;
      dtLocal?: string;
      dtIri?: string;
    }
  | { k: "prefix"; prefix: string; iri: string }
  | { k: "base"; iri: string };

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  const isWS = (c: string) =>
    c === " " || c === "\t" || c === "\r" || c === "\n";

  const readString = (): { v: string } => {
    // assumes input[i] is a quote
    const q = input[i];
    // triple-quoted?
    if (input[i + 1] === q && input[i + 2] === q) {
      i += 3;
      let s = "";
      while (
        i < n &&
        !(input[i] === q && input[i + 1] === q && input[i + 2] === q)
      ) {
        if (input[i] === "\\") {
          s += input[i] + input[i + 1];
          i += 2;
          continue;
        }
        s += input[i++];
      }
      i += 3;
      return { v: unescape(s) };
    }
    i += 1;
    let s = "";
    while (i < n && input[i] !== q) {
      if (input[i] === "\\") {
        s += input[i] + input[i + 1];
        i += 2;
        continue;
      }
      s += input[i++];
    }
    i += 1;
    return { v: unescape(s) };
  };

  const unescape = (s: string) =>
    s
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\");

  const readUntilWS = (extraStops = ""): string => {
    let s = "";
    while (
      i < n &&
      !isWS(input[i]) &&
      !";,.[]()".includes(input[i]) &&
      !extraStops.includes(input[i])
    ) {
      s += input[i++];
    }
    return s;
  };

  while (i < n) {
    const c = input[i];
    if (isWS(c)) {
      i++;
      continue;
    }
    if (c === "#") {
      while (i < n && input[i] !== "\n") i++;
      continue;
    }

    // directives
    if (c === "@") {
      const word = input.slice(i).match(/^@(prefix|base)\b/i);
      if (word) {
        const kind = word[1].toLowerCase();
        i += word[0].length;
        while (i < n && isWS(input[i])) i++;
        if (kind === "prefix") {
          const pn = readUntilWS(":");
          // expect ':'
          if (input[i] === ":") i++;
          while (i < n && isWS(input[i])) i++;
          // IRI
          let iri = "";
          if (input[i] === "<") {
            i++;
            while (i < n && input[i] !== ">") iri += input[i++];
            i++;
          }
          while (i < n && input[i] !== ".") i++;
          i++; // consume '.'
          toks.push({ k: "prefix", prefix: pn, iri });
        } else {
          while (i < n && isWS(input[i])) i++;
          let iri = "";
          if (input[i] === "<") {
            i++;
            while (i < n && input[i] !== ">") iri += input[i++];
            i++;
          }
          while (i < n && input[i] !== ".") i++;
          i++;
          toks.push({ k: "base", iri });
        }
        continue;
      }
    }
    // SPARQL-style PREFIX / BASE (no leading @, no trailing .)
    const sparql = input.slice(i).match(/^(PREFIX|BASE)\b/i);
    if (sparql) {
      const kind = sparql[1].toUpperCase();
      i += sparql[0].length;
      while (i < n && isWS(input[i])) i++;
      if (kind === "PREFIX") {
        const pn = readUntilWS(":");
        if (input[i] === ":") i++;
        while (i < n && isWS(input[i])) i++;
        let iri = "";
        if (input[i] === "<") {
          i++;
          while (i < n && input[i] !== ">") iri += input[i++];
          i++;
        }
        toks.push({ k: "prefix", prefix: pn, iri });
      } else {
        while (i < n && isWS(input[i])) i++;
        let iri = "";
        if (input[i] === "<") {
          i++;
          while (i < n && input[i] !== ">") iri += input[i++];
          i++;
        }
        toks.push({ k: "base", iri });
      }
      continue;
    }

    if (
      c === "." ||
      c === ";" ||
      c === "," ||
      c === "[" ||
      c === "]" ||
      c === "(" ||
      c === ")"
    ) {
      toks.push({ k: "punc", v: c as "." });
      i++;
      continue;
    }

    if (c === "<") {
      i++;
      let iri = "";
      while (i < n && input[i] !== ">") iri += input[i++];
      i++;
      toks.push({ k: "iri", v: iri });
      continue;
    }

    if (c === '"' || c === "'") {
      const { v } = readString();
      let lang: string | undefined;
      let dtPrefix: string | undefined,
        dtLocal: string | undefined,
        dtIri: string | undefined;
      if (input[i] === "@") {
        i++;
        let l = "";
        while (i < n && /[a-zA-Z0-9-]/.test(input[i])) l += input[i++];
        lang = l;
      } else if (input[i] === "^" && input[i + 1] === "^") {
        i += 2;
        if (input[i] === "<") {
          i++;
          let d = "";
          while (i < n && input[i] !== ">") d += input[i++];
          i++;
          dtIri = d;
        } else {
          const tok = readUntilWS();
          const idx = tok.indexOf(":");
          dtPrefix = tok.slice(0, idx);
          dtLocal = tok.slice(idx + 1);
        }
      }
      toks.push({ k: "lit", v, lang, dtPrefix, dtLocal, dtIri });
      continue;
    }

    if (c === "_" && input[i + 1] === ":") {
      i += 2;
      let lbl = "";
      while (i < n && !isWS(input[i]) && !";,.[]()".includes(input[i]))
        lbl += input[i++];
      toks.push({ k: "blank", v: lbl });
      continue;
    }

    // 'a' keyword (rdf:type) — standalone
    if (c === "a" && (isWS(input[i + 1]) || input[i + 1] === undefined)) {
      toks.push({ k: "a" });
      i++;
      continue;
    }

    // prefixed name or boolean/number literal
    const word = readUntilWS();
    if (word === "") {
      i++;
      continue;
    }
    const colon = word.indexOf(":");
    if (colon >= 0 && !/^https?:/.test(word)) {
      toks.push({
        k: "pname",
        prefix: word.slice(0, colon),
        local: word.slice(colon + 1),
      });
    } else if (
      /^(true|false)$/.test(word) ||
      /^[+-]?[\d.]+([eE][+-]?\d+)?$/.test(word)
    ) {
      toks.push({ k: "lit", v: word });
    } else {
      // unknown bareword — treat as literal to avoid crashing
      toks.push({ k: "lit", v: word });
    }
  }
  return toks;
}

/* ─── Parser: tokens → triples ───────────────────────────────── */
function parseTriples(input: string): Triple[] {
  const toks = tokenize(input);
  const prefixes: Record<string, string> = {};
  let base = "";
  // first pass collect prefixes (also handle inline ordering)
  const triples: Triple[] = [];
  let blankCounter = 0;
  const newBlank = (): Term => ({ t: "blank", v: `_:b${blankCounter++}` });

  const resolve = (tok: Tok): Term => {
    if (tok.k === "iri")
      return {
        t: "iri",
        v: base && !/^[a-z]+:/i.test(tok.v) ? base + tok.v : tok.v,
      };
    if (tok.k === "pname")
      return {
        t: "iri",
        v: (prefixes[tok.prefix] ?? `${tok.prefix}:`) + tok.local,
      };
    if (tok.k === "blank") return { t: "blank", v: "_:" + tok.v };
    if (tok.k === "lit") {
      const dt = tok.dtIri
        ? tok.dtIri
        : tok.dtPrefix !== undefined
          ? (prefixes[tok.dtPrefix] ?? "") + (tok.dtLocal ?? "")
          : undefined;
      return { t: "lit", v: tok.v, lang: tok.lang, dt };
    }
    if (tok.k === "a")
      return { t: "iri", v: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" };
    return { t: "iri", v: "" };
  };

  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  // parse an object, possibly a blank-node list [] or collection ()
  const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
  const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
  const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

  const parseObject = (): Term => {
    const tok = peek();
    if (tok && tok.k === "punc" && tok.v === "[") {
      next();
      const bnode = newBlank();
      parsePredicateList(bnode, "]");
      return bnode;
    }
    if (tok && tok.k === "punc" && tok.v === "(") {
      next();
      // RDF collection
      const items: Term[] = [];
      while (
        peek() &&
        !(peek().k === "punc" && (peek() as { v: string }).v === ")")
      ) {
        items.push(parseObject());
      }
      next(); // consume ')'
      if (items.length === 0) return { t: "iri", v: RDF_NIL };
      let head = newBlank();
      const first = head;
      items.forEach((it, idx) => {
        triples.push({ s: head, p: { t: "iri", v: RDF_FIRST }, o: it });
        if (idx < items.length - 1) {
          const rest = newBlank();
          triples.push({ s: head, p: { t: "iri", v: RDF_REST }, o: rest });
          head = rest;
        } else {
          triples.push({
            s: head,
            p: { t: "iri", v: RDF_REST },
            o: { t: "iri", v: RDF_NIL },
          });
        }
      });
      return first;
    }
    return resolve(next());
  };

  // parse "pred obj (, obj)* (; pred obj ...)*" until terminator ('.' top-level or ']' for blank)
  const parsePredicateList = (subject: Term, term: "." | "]") => {
    while (true) {
      const t = peek();
      if (!t) return;
      if (t.k === "punc" && t.v === term) {
        next();
        return;
      }
      if (t.k === "punc" && t.v === ";") {
        next();
        continue;
      }
      if (t.k === "punc" && t.v === ",") {
        next();
        continue;
      } // handled below via lastPred
      // predicate
      if (t.k === "prefix" || t.k === "base") {
        next();
        continue;
      }
      const pred = resolve(next());
      // object list
      let obj = parseObject();
      triples.push({ s: subject, p: pred, o: obj });
      while (
        peek() &&
        peek().k === "punc" &&
        (peek() as { v: string }).v === ","
      ) {
        next();
        obj = parseObject();
        triples.push({ s: subject, p: pred, o: obj });
      }
    }
  };

  while (p < toks.length) {
    const t = peek();
    if (!t) break;
    if (t.k === "prefix") {
      prefixes[t.prefix] = t.iri;
      next();
      continue;
    }
    if (t.k === "base") {
      base = t.iri;
      next();
      continue;
    }
    if (t.k === "punc" && t.v === ".") {
      next();
      continue;
    }
    // subject
    const subj = parseObject(); // handles [] / iri / pname
    parsePredicateList(subj, ".");
  }
  return triples;
}

/* ─── SAMM interpretation ────────────────────────────────────── */
export interface SammNode {
  kind: "aspect" | "property" | "entity";
  name: string;
  preferredName?: string;
  characteristic?: string;
  dataType?: string;
  optional?: boolean;
  collection?: string; // e.g. "List" / "Set" / "Collection"
  enumValues?: string[];
  children?: SammNode[];
}

const frag = (iri: string): string => {
  const h = iri.lastIndexOf("#");
  if (h >= 0) return iri.slice(h + 1);
  const s = iri.lastIndexOf("/");
  return s >= 0 ? iri.slice(s + 1) : iri;
};

const localName = (iri: string): string => frag(iri);

interface Index {
  // subject iri → predicate frag → object Terms
  bySubject: Map<string, Map<string, Term[]>>;
  triples: Triple[];
}

function buildIndex(triples: Triple[]): Index {
  const bySubject = new Map<string, Map<string, Term[]>>();
  for (const tr of triples) {
    const sk = tr.s.v;
    let m = bySubject.get(sk);
    if (!m) {
      m = new Map();
      bySubject.set(sk, m);
    }
    const pf = tr.p.t === "iri" ? frag(tr.p.v) : tr.p.v;
    const arr = m.get(pf) ?? [];
    arr.push(tr.o);
    m.set(pf, arr);
  }
  return { bySubject, triples };
}

const RDF_FIRST_F = "first";
const RDF_REST_F = "rest";
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

// follow an rdf:list head term → ordered Terms
function readList(idx: Index, head: Term): Term[] {
  const out: Term[] = [];
  let cur: Term | undefined = head;
  const guard = new Set<string>();
  while (cur && cur.v !== RDF_NIL) {
    if (cur.t !== "blank" && cur.t !== "iri") break;
    if (guard.has(cur.v)) break;
    guard.add(cur.v);
    const m = idx.bySubject.get(cur.v);
    if (!m) break;
    const first = m.get(RDF_FIRST_F)?.[0];
    if (first) out.push(first);
    cur = m.get(RDF_REST_F)?.[0];
  }
  return out;
}

const langPick = (terms: Term[] | undefined): string | undefined => {
  if (!terms?.length) return undefined;
  const lits = terms.filter(t => t.t === "lit") as Array<{
    v: string;
    lang?: string;
  }>;
  if (!lits.length) return undefined;
  return (
    lits.find(l => l.lang === "ko") ??
    lits.find(l => l.lang === "en") ??
    lits[0]
  ).v;
};

function typeFrags(idx: Index, subjectIri: string): string[] {
  const m = idx.bySubject.get(subjectIri);
  const types = m?.get("type") ?? [];
  return types.map(t => (t.t === "iri" ? frag(t.v) : ""));
}

const COLLECTION_FRAGS = new Set([
  "Collection",
  "List",
  "Set",
  "SortedSet",
  "TimeSeries",
]);

function characteristicInfo(
  idx: Index,
  charTerm: Term
): {
  name: string;
  collection?: string;
  dataTypeIri?: string;
  enumValues?: string[];
} {
  const name = localName(charTerm.v);
  const m = idx.bySubject.get(charTerm.v);
  const types = (m?.get("type") ?? []).map(t => frag(t.v));
  let collection: string | undefined;
  for (const tf of types) if (COLLECTION_FRAGS.has(tf)) collection = tf;
  // also if the characteristic name itself is a collection meta class
  if (!collection && COLLECTION_FRAGS.has(name)) collection = name;
  const dataType = m?.get("dataType")?.[0];
  let enumValues: string[] | undefined;
  const values = m?.get("values")?.[0];
  if (values) {
    const list = readList(idx, values);
    enumValues = list
      .map(v => (v.t === "lit" ? v.v : localName(v.v)))
      .slice(0, 12);
  }
  return { name, collection, dataTypeIri: dataType?.v, enumValues };
}

export interface SammAspect extends SammNode {
  kind: "aspect";
}

/**
 * TTL/RDF 본문에서 SAMM Aspect 구조 트리를 파싱한다.
 * Aspect 가 없거나 파싱 실패 시 null 을 반환(호출부는 원문으로 폴백).
 */
export function parseSammAspect(ttl: string): SammAspect | null {
  if (!ttl || ttl.trim() === "") return null;
  try {
    const triples = parseTriples(ttl);
    if (triples.length === 0) return null;
    const idx = buildIndex(triples);

    // find an Aspect subject
    let aspectIri: string | undefined;
    for (const [s] of idx.bySubject) {
      if (typeFrags(idx, s).includes("Aspect")) {
        aspectIri = s;
        break;
      }
    }
    if (!aspectIri) return null;

    const visited = new Set<string>();

    const buildProperties = (subjectIri: string, depth: number): SammNode[] => {
      if (depth > 8) return [];
      const m = idx.bySubject.get(subjectIri);
      const propsHead = m?.get("properties")?.[0];
      if (!propsHead) return [];
      const entries = readList(idx, propsHead);
      const nodes: SammNode[] = [];
      for (const entry of entries) {
        // entry is either a Property IRI, or a blank node { property: X, optional: true, payloadName: ... }
        let propIri = entry.v;
        let optional = false;
        if (entry.t === "blank") {
          const bm = idx.bySubject.get(entry.v);
          const prop = bm?.get("property")?.[0];
          if (prop) propIri = prop.v;
          const opt = bm?.get("optional")?.[0];
          if (opt && opt.t === "lit" && /true/i.test(opt.v)) optional = true;
          const notInPayload = bm?.get("notInPayload")?.[0];
          if (
            notInPayload &&
            notInPayload.t === "lit" &&
            /true/i.test(notInPayload.v)
          )
            optional = optional || false;
        }
        const node = buildPropertyNode(propIri, optional, depth);
        if (node) nodes.push(node);
      }
      return nodes;
    };

    const buildPropertyNode = (
      propIri: string,
      optional: boolean,
      depth: number
    ): SammNode | null => {
      if (!propIri) return null;
      const pm = idx.bySubject.get(propIri);
      const node: SammNode = {
        kind: "property",
        name: localName(propIri),
        preferredName: langPick(pm?.get("preferredName")),
        optional: optional || undefined,
      };
      const charTerm = pm?.get("characteristic")?.[0];
      if (charTerm) {
        const ci = characteristicInfo(idx, charTerm);
        node.characteristic = ci.name;
        if (ci.collection) node.collection = ci.collection;
        if (ci.enumValues?.length) node.enumValues = ci.enumValues;
        // resolve dataType → may be Entity
        const dtIri = ci.dataTypeIri;
        if (dtIri) {
          node.dataType = localName(dtIri);
          const dtTypes = typeFrags(idx, dtIri);
          if (dtTypes.includes("Entity") && !visited.has(dtIri) && depth < 8) {
            visited.add(dtIri);
            const children = buildProperties(dtIri, depth + 1);
            if (children.length) {
              node.children = children;
              node.kind = "entity";
            }
            visited.delete(dtIri);
          }
        }
      }
      return node;
    };

    const am = idx.bySubject.get(aspectIri);
    const aspect: SammAspect = {
      kind: "aspect",
      name: localName(aspectIri),
      preferredName: langPick(am?.get("preferredName")),
      children: buildProperties(aspectIri, 0),
    };
    return aspect;
  } catch {
    return null;
  }
}
