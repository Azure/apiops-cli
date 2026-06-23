# Configure APIOps Extractor Filters

> **How to use:** Open this file in VS Code with GitHub Copilot and ask
> Copilot to help you design a `configuration.extractor.yaml` file for your
> repository.

## Goal

Create a `configuration.extractor.yaml` file that limits APIOps extraction to
the Azure API Management resources your team wants to manage in source control.

---

## Step 1 — Gather Requirements

Copilot, ask the user which APIM resources should be included or excluded from
extraction. Confirm details such as:

- APIs to include or exclude
- Products to include or exclude
- Named values, backends, loggers, gateways, tags, and version sets
- Whether the team prefers broad extraction first, then tightening filters later

Summarize the answers before generating any YAML.

---

## Step 2 — Propose a Filter Strategy

Based on the user's answers:

1. Recommend the smallest filter that safely captures the intended scope
2. Explain any tradeoffs between broad and narrow filters
3. Call out any risk of accidentally excluding required dependencies

If the user is unsure, start with a conservative filter that is easy to refine.

---

## Step 3 — Generate `configuration.extractor.yaml`

Create the full YAML file content for `configuration.extractor.yaml`.

Requirements:

- Include the schema comment at the top of the file:
  `# yaml-language-server: $schema=https://raw.githubusercontent.com/Azure/apiops-cli/main/schemas/extractor-config.schema.json`
- Output valid YAML only when generating the final file
- Preserve any APIOps-supported filter structure the user requests
- Prefer readable comments only when they help explain a non-obvious choice
- Do not invent resource names — ask the user or use placeholders when needed

---

## Step 4 — Validate the Result

Before finishing:

1. Review the generated YAML for syntax issues
2. Confirm the filters align with the user's intended extraction scope
3. Remind the user to run the extractor and inspect the artifact output

If the extractor output is too broad or too narrow, help the user refine the
filter file iteratively.
