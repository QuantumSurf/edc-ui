{{/*
Expand the name of the chart.
*/}}
{{- define "kmx-edc-ui.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "kmx-edc-ui.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kmx-edc-ui.labels" -}}
helm.sh/chart: {{ include "kmx-edc-ui.name" . }}-{{ .Chart.Version }}
{{ include "kmx-edc-ui.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "kmx-edc-ui.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kmx-edc-ui.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name
*/}}
{{- define "kmx-edc-ui.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "kmx-edc-ui.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Database URL — prefers built-in postgresql sub-chart, falls back to externalDatabase.
*/}}
{{- define "kmx-edc-ui.databaseUrl" -}}
{{- if .Values.postgresql.enabled }}
{{- $host := printf "%s-postgresql" .Release.Name }}
{{- $user := .Values.postgresql.auth.username }}
{{- $db   := .Values.postgresql.auth.database }}
{{- printf "postgresql://%s:$(DB_PASSWORD)@%s:5432/%s" $user $host $db }}
{{- else }}
{{- $host := .Values.externalDatabase.host }}
{{- $port := .Values.externalDatabase.port | toString }}
{{- $user := .Values.externalDatabase.username }}
{{- $db   := .Values.externalDatabase.database }}
{{- printf "postgresql://%s:$(DB_PASSWORD)@%s:%s/%s" $user $host $port $db }}
{{- end }}
{{- end }}

{{/*
Database secret name
*/}}
{{- define "kmx-edc-ui.dbSecretName" -}}
{{- if .Values.postgresql.enabled }}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- printf "%s-postgresql" .Release.Name }}
{{- end }}
{{- else }}
{{- if .Values.externalDatabase.existingSecret }}
{{- .Values.externalDatabase.existingSecret }}
{{- else }}
{{- include "kmx-edc-ui.fullname" . }}-secret
{{- end }}
{{- end }}
{{- end }}

{{/*
Database secret password key
*/}}
{{- define "kmx-edc-ui.dbSecretPasswordKey" -}}
{{- if .Values.postgresql.enabled }}
{{- "password" }}
{{- else }}
{{- .Values.externalDatabase.existingSecretPasswordKey }}
{{- end }}
{{- end }}
