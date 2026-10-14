# 🌐 AI Agent Skills — Master Sources & Download Registry

This document lists all upstream repositories, distribution packages, and commands used to download and maintain all **2,689+ AI skills** in your environment.

---

## 📍 Local Storage & Paths
* **Global Skills Directory:** `C:\Users\mrtx1\.agent\skills` (or `~/.agent/skills`)
* **Workspace Junction:** `d:\Python\Git_repos\axiom\.agent\skills`
* **Local Manifest File:** `~/.agent/skills/.antigravity-install-manifest.json`

---

## ⚡ Quick Update Commands

```bash
# 1. Update all 2,689+ skills from all aggregated upstream sources
npx agentic-awesome-skills --antigravity --all

# 2. Check for upstream updates without modifying disk (Dry Run)
npx agentic-awesome-skills --antigravity --all --dry-run

# 3. Audit all local skills for missing files or broken links
npx agentic-awesome-skills audit

# 4. Update individually tracked packages via Skills CLI
npx skills update

# 5. One-click PowerShell script (built into Axiom)
.\scripts\update-skills.ps1
```

---

## 📦 1. Primary Aggregator & Package Managers

| Source / Package | Repository URL | What It Powers |
| :--- | :--- | :--- |
| **`agentic-awesome-skills` (AAS)** | https://github.com/sickn33/agentic-awesome-skills | Core distribution containing 2,689+ skills across AI, Cloud, DevSec, and Frameworks. |
| **`skills` CLI** | https://github.com/vercel-labs/skills | Open skill package manager for searching and installing modular agent skills. |

---

## 🏢 2. Official Vendor & Enterprise Repositories

| Vendor / Organization | Repository URL | Key Skills & Focus |
| :--- | :--- | :--- |
| **Microsoft** | https://github.com/microsoft/skills | 140+ official skills: Azure AI Foundry, M365 Agents, Entra ID, Key Vault, Event Hubs, Cosmos DB, Azure SQL |
| **Vercel Labs** | https://github.com/vercel-labs/agent-skills | Next.js App Router, React Server Components, Vercel deployments, web performance |
| **Hugging Face** | https://github.com/huggingface/skills | HF CLI, Datasets, Gradio Spaces, Hub persistence, Jobs, Model training, Transformers.js |
| **Trail of Bits** | https://github.com/trailofbits/skills | Security audit workflows, Semgrep rules, AppSec review, code hardening, invariant analysis |
| **Sentry** | https://github.com/getsentry/skills | PR review champions, automated commit generation, bug hunting, git workflows |
| **Expo** | https://github.com/expo/skills | Expo Router, Native UI (SwiftUI / Jetpack Compose), Tailwind setup, SDK migrations |
| **Neon Database** | https://github.com/neondatabase/agent-skills | Serverless PostgreSQL patterns, branching, connection pooling, performance tuning |
| **Google Labs (Stitch)** | https://github.com/google-labs-code/stitch-skills | Stitch UI generation, design token synthesis (`design-md`) |
| **Weaviate** | https://github.com/weaviate/agent-skills | Vector search, RAG pipeline design, vector DB administration |
| **fal.ai** | https://github.com/fal-ai-community/skills | Generative AI models for image, video, audio, upscale, editing workflows |
| **HasData** | https://github.com/HasData/hasdata-cli | Structured web data extraction, scraping, SERP analysis |

---

## 🛠️ 3. Specialized Community & Research Repositories

| Domain / Creator | Repository URL | Description & Skills |
| :--- | :--- | :--- |
| **Reverse Engineering & Security** *(zhaoxuya520)* | https://github.com/zhaoxuya520/reverse-skill | 43 reverse engineering skills: IDA Pro, Ghidra, Radare2, GDB, APK decompilation, binary diffing, malware analysis, CTF sandbox |
| **Frontend UI/UX Taste & Aesthetics** *(Leonxlnx)* | https://github.com/Leonxlnx/taste-skill | Design taste protocols, minimalist UI, brutalist UI, typography and layout enforcement |
| **Apple Platforms & Swift** *(Dimillian)* | https://github.com/Dimillian/Skills | macOS menu bar apps, Tuist, SPM packaging, Swift concurrency, SwiftUI patterns |
| **Context Engineering** *(muratcankoylan)* | https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering | Context compression, degradation defense, multi-agent coordination patterns |
| **Curated Agent Skills Collection** *(VoltAgent)* | https://github.com/VoltAgent/awesome-agent-skills | Curated multi-agent coordination, testing tools, cloud patterns |
| **Functional Programming** *(whatiskadudoing)* | https://github.com/whatiskadudoing/fp-ts-skills | `fp-ts` pragmatic pipelines, TaskEither error handling, functional React |
| **Scientific Computing & Bio** *(K-Dense-AI)* | https://github.com/K-Dense-AI/claude-scientific-skills | NumPy, SciPy, Matplotlib, BioPython, Scanpy, PubMed querying |
| **Workflow Automation (n8n)** *(czlonkowski)* | https://github.com/czlonkowski/n8n-skills | n8n expression syntax, validation rules, MCP integration, subworkflows |
| **UI Polish & Mobile Layouts** *(ibelick)* | https://github.com/ibelick/ui-skills | Opinionated UI constraints, accessibility fixes, motion performance |
| **Three.js & WebGL 3D** *(CloudAI-X)* | https://github.com/CloudAI-X/threejs-skills | Shaders, lighting, geometry, materials, post-processing |
| **Security Testing & Web Fuzzing** *(jthack)* | https://github.com/jthack/ffuf_claude_skill | Web fuzzing with `ffuf`, parameter discovery |
| **Vector CLI & Local Search** *(scarletkc)* | https://github.com/scarletkc/vexor | Semantic file discovery using vector embeddings |
| **WhatsApp Automation** *(gokapso)* | https://github.com/gokapso/agent-skills | WhatsApp business automation and observation |
| **Linear Project Management** *(wrsmith108)* | https://github.com/wrsmith108/linear-claude-skill | Linear issue tracking, triage, sprint automation |
| **Environment Variable Security** *(wrsmith108)* | https://github.com/wrsmith108/varlock-claude-skill | Secure env variable management (`varlock`) |
| **Rails Upgrades** *(robzolkos)* | https://github.com/robzolkos/skill-rails-upgrade | Automated Rails upgrade assessments and migration |
| **Pairwise Testing** *(omkamal)* | https://github.com/omkamal/pypict-claude-skill | Pairwise test generation using PICT |
| **Makepad Rust UI** *(ZhangHanDong)* | https://github.com/ZhangHanDong/makepad-skills | Makepad 2.0 UI development in Rust |
| **SwiftUI Agent Skill** *(AvdLee)* | https://github.com/AvdLee/SwiftUI-Agent-Skill | Modern SwiftUI development best practices |
| **Google Workspace Automation** *(sanjay3290)* | https://github.com/sanjay3290/ai-skills | Google Docs, Sheets, Drive, Slides, Gmail automation |
| **Health & Wellness Tracking** *(huifer)* | https://github.com/huifer/Claude-Ally-Health | Sleep, nutrition, fitness analysis |
| **RAG Quality Verification** *(frmoretto)* | https://github.com/frmoretto/clarity-gate | RAG pipeline evaluation and quality gates |
| **Skill Conversion Utilities** *(yusufkaraaslan)* | https://github.com/yusufkaraaslan/Skill_Seekers | Tools for transforming docs into agent skills |
| **HTML Presentations** *(zarazhangrui)* | https://github.com/zarazhangrui/frontend-slides | Animated HTML presentation generator |

---

## 🔍 4. All 43 Reverse Engineering Skills (`zhaoxuya520/reverse-skill`)

All 43 skills from [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) installed locally in `~/.agent/skills`:

```
active-directory-attacks    anti-reversing-techniques   apk-redteam-pipeline
apk-reverse                 binary-analysis-patterns    binary-diff
binary-ninja-reverse        browser-extension-reverse   burp-suite-testing
burpsuite-project-parser    cloud-iam-deep              cloud-penetration-testing
ctf-sandbox                 darkmoon-pentest            dast-scanning
differential-review         dotnet-reverse              edr-bypass-re
enterprise-vpn-attack       ffuf-web-fuzzing            firmware-analyst
firmware-pentest            gdb-cli                     ghidra-reverse
go-rust-reverse             hardware-security           ida-reverse
ios-redteam-pipeline        js-reverse                  linux-privilege-escalation
macos-reverse               malware-analysis            malware-analyst
metasploit-framework        mobile-reverse              okta-attack
patch-diff-exploit          privilege-escalation-methods protocol-reverse
protocol-reverse-engineering pwn-chain                  radare2
windows-ad
```

---

## 📋 5. Raw URL List (Easy Copy & Paste)

```text
https://github.com/sickn33/agentic-awesome-skills
https://github.com/vercel-labs/skills
https://github.com/microsoft/skills
https://github.com/vercel-labs/agent-skills
https://github.com/huggingface/skills
https://github.com/trailofbits/skills
https://github.com/getsentry/skills
https://github.com/expo/skills
https://github.com/neondatabase/agent-skills
https://github.com/google-labs-code/stitch-skills
https://github.com/weaviate/agent-skills
https://github.com/fal-ai-community/skills
https://github.com/HasData/hasdata-cli
https://github.com/zhaoxuya520/reverse-skill
https://github.com/Leonxlnx/taste-skill
https://github.com/Dimillian/Skills
https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering
https://github.com/VoltAgent/awesome-agent-skills
https://github.com/whatiskadudoing/fp-ts-skills
https://github.com/K-Dense-AI/claude-scientific-skills
https://github.com/czlonkowski/n8n-skills
https://github.com/ibelick/ui-skills
https://github.com/CloudAI-X/threejs-skills
https://github.com/jthack/ffuf_claude_skill
https://github.com/scarletkc/vexor
https://github.com/gokapso/agent-skills
https://github.com/wrsmith108/linear-claude-skill
https://github.com/wrsmith108/varlock-claude-skill
https://github.com/robzolkos/skill-rails-upgrade
https://github.com/omkamal/pypict-claude-skill
https://github.com/ZhangHanDong/makepad-skills
https://github.com/AvdLee/SwiftUI-Agent-Skill
https://github.com/sanjay3290/ai-skills
https://github.com/huifer/Claude-Ally-Health
https://github.com/frmoretto/clarity-gate
https://github.com/yusufkaraaslan/Skill_Seekers
https://github.com/zarazhangrui/frontend-slides
```
