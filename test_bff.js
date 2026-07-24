const http = require("http");

async function test() {
  // Step 1: Login
  const loginRes = await new Promise((resolve, reject) => {
    const data = JSON.stringify({
      participant: "BPNL000000000PRD",
      password: "0000",
    });

    const opts = {
      hostname: "localhost",
      port: 3001,
      path: "/api/auth/login",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(opts, res => {
      let body = "";
      res.on("data", chunk => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });

  console.log("=== LOGIN ===");
  console.log("Status:", loginRes.status);

  let token = "";
  try {
    const parsed = JSON.parse(loginRes.body);
    token = parsed.token;
    console.log("Token:", token.substring(0, 30) + "...");
  } catch (e) {
    console.log("Parse error:", e.message);
    console.log("Body:", loginRes.body);
    return;
  }

  // Step 2: Get connectors
  const connRes = await new Promise((resolve, reject) => {
    const opts = {
      hostname: "localhost",
      port: 3001,
      path: "/api/connectors",
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
      },
    };

    const req = http.request(opts, res => {
      let body = "";
      res.on("data", chunk => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });

  console.log("\n=== GET /api/connectors ===");
  console.log("Status:", connRes.status);

  let connectors = [];
  try {
    connectors = JSON.parse(connRes.body);
    console.log("Connector count:", connectors.length);
    if (connectors.length > 0) {
      console.log("First connector ID:", connectors[0].id);
      console.log("First connector name:", connectors[0].name);
      console.log("First connector status:", connectors[0].status);
    }
  } catch (e) {
    console.log("Parse error:", e.message);
  }

  if (connectors.length === 0) {
    console.log("No connectors found");
    return;
  }

  const firstConnId = connectors[0].id;

  // Step 3: Test endpoints
  const endpoints = [
    "/api/connectors/" + firstConnId + "/assets",
    "/api/connectors/" + firstConnId + "/policies",
    "/api/connectors/" + firstConnId + "/offerings",
    "/api/connectors/" + firstConnId + "/negotiations",
    "/api/connectors/" + firstConnId + "/transfers",
    "/api/connectors/" + firstConnId + "/edrs",
  ];

  console.log("\n=== Testing endpoints for connector: " + firstConnId + " ===");

  for (const path of endpoints) {
    await new Promise(resolve => {
      const opts = {
        hostname: "localhost",
        port: 3001,
        path: path,
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
        },
      };

      const req = http.request(opts, res => {
        let body = "";
        res.on("data", chunk => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            const count = Array.isArray(parsed)
              ? parsed.length
              : parsed.data
                ? Array.isArray(parsed.data)
                  ? parsed.data.length
                  : 0
                : 0;
            console.log(
              "GET " +
                path.split("/").pop() +
                " | Status: " +
                res.statusCode +
                " | Count: " +
                count
            );
          } catch {
            console.log(
              "GET " + path.split("/").pop() + " | Status: " + res.statusCode
            );
          }
          resolve();
        });
      });
      req.on("error", e => {
        console.log("GET " + path + " | Error: " + e.message);
        resolve();
      });
      req.end();
    });
  }

  // Step 4: Catalog test
  await new Promise(resolve => {
    const data = JSON.stringify({
      dspEndpoint: "http://mock-edc:8090/api/v1/dsp",
    });

    const opts = {
      hostname: "localhost",
      port: 3001,
      path: "/api/connectors/" + firstConnId + "/catalog",
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = http.request(opts, res => {
      let body = "";
      res.on("data", chunk => (body += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          const datasets = parsed["dcat:dataset"] || [];
          console.log(
            "POST /catalog | Status: " +
              res.statusCode +
              " | Datasets: " +
              datasets.length
          );
        } catch {
          console.log("POST /catalog | Status: " + res.statusCode);
        }
        resolve();
      });
    });
    req.on("error", e => {
      console.log("POST /catalog | Error: " + e.message);
      resolve();
    });
    req.write(data);
    req.end();
  });

  // Step 5: Test non-existent connector
  console.log("\n=== Testing error handling (non-existent connector) ===");
  await new Promise(resolve => {
    const opts = {
      hostname: "localhost",
      port: 3001,
      path: "/api/connectors/nonexistent-id-12345/assets",
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
      },
    };

    const req = http.request(opts, res => {
      let body = "";
      res.on("data", chunk => (body += chunk));
      res.on("end", () => {
        console.log("GET /nonexistent/assets | Status: " + res.statusCode);
        if (res.statusCode !== 200 && body) {
          try {
            const err = JSON.parse(body);
            console.log("Error detail:", err);
          } catch {
            console.log("Error body:", body.substring(0, 200));
          }
        }
        resolve();
      });
    });
    req.on("error", e => {
      console.log("GET /nonexistent/assets | Error: " + e.message);
      resolve();
    });
    req.end();
  });
}

test().catch(e => console.error("Fatal error:", e.message));
