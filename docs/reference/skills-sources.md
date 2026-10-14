# Skills Sources & Upstream Repositories Directory

> **Registry Location:** `~/.agent/skills` (junctioned at `.agent/skills`)  
> **Total Skills Tracked:** 2,689+  
> **Primary Package:** [`agentic-awesome-skills`](https://www.npmjs.com/package/agentic-awesome-skills) (v19.6.0)

---

## 1. Primary Aggregator & Distribution Package

The bulk of all skills (2,689+) is maintained and distributed via the `agentic-awesome-skills` ecosystem:

| Project | Source Repository / Package | Description | Update Command |
| :--- | :--- | :--- | :--- |
| **Agentic Awesome Skills (AAS)** | [github.com/sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills)<br>*(npm: `agentic-awesome-skills`)* | Master aggregator indexing, formatting, and verifying 2,689+ agentic skills across AI, Cloud, DevSec, and Frameworks. | `npx agentic-awesome-skills --antigravity --all` |
| **Open Skills CLI** | [github.com/vercel-labs/skills](https://github.com/vercel-labs/skills)<br>*(npm: `skills`)* | CLI for discovering and syncing modular individual skills from the open community index. | `npx skills update` |

---

## 2. Official Vendor & Enterprise Repositories

These are official repositories published and maintained by tech companies and security research firms:

| Vendor / Project | Source Repository | Included Skills & Focus |
| :--- | :--- | :--- |
| **Microsoft** | [github.com/microsoft/skills](https://github.com/microsoft/skills) | 140+ official skills: Azure AI Foundry, M365 Agents, Entra ID, Key Vault, Event Hubs, Cosmos DB, Azure SQL. |
| **Vercel Labs** | [github.com/vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Vercel deployment, React Server Components, Next.js optimization. |
| **Hugging Face** | [github.com/huggingface/skills](https://github.com/huggingface/skills) | Hugging Face CLI, Datasets, Gradio Spaces, Hub persistence, Jobs, Model training, Transformers.js. |
| **Trail of Bits** | [github.com/trailofbits/skills](https://github.com/trailofbits/skills) | Security audit workflows, Semgrep rules, AppSec review, code hardening, invariant analysis. |
| **Sentry** | [github.com/getsentry/skills](https://github.com/getsentry/skills) | Automated commit generation, PR review champions, bug hunting, git workflows. |
| **Expo** | [github.com/expo/skills](https://github.com/expo/skills) | Expo Router, Native UI (SwiftUI / Jetpack Compose), Tailwind setup, SDK migrations. |
| **Neon Database** | [github.com/neondatabase/agent-skills](https://github.com/neondatabase/agent-skills) | Serverless PostgreSQL patterns, branching, connection pooling, performance tuning. |
| **Google Labs (Stitch)** | [github.com/google-labs-code/stitch-skills](https://github.com/google-labs-code/stitch-skills) | Stitch UI generation, design token synthesis (`design-md`). |
| **Weaviate** | [github.com/weaviate/agent-skills](https://github.com/weaviate/agent-skills) | Vector search, RAG pipeline design, vector DB administration. |
| **fal.ai** | [github.com/fal-ai-community/skills](https://github.com/fal-ai-community/skills) | Generative image, video, audio models, upscale, editing workflows. |
| **HasData** | [github.com/HasData/hasdata-cli](https://github.com/HasData/hasdata-cli) | Structured web data extraction, scraping, SERP analysis. |

---

## 3. Specialized Community & Research Repositories

These repositories contain focused domain expertise:

| Domain / Creator | Source Repository | Key Capabilities |
| :--- | :--- | :--- |
| **Reverse Engineering & Binary Analysis**<br>*(zhaoxuya520)* | [github.com/zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) | 43 reverse engineering skills: IDA Pro, Ghidra, Radare2, GDB, APK decompilation, binary diffing, malware analysis, CTF sandbox. |
| **Frontend UI/UX Taste & Aesthetics**<br>*(Leonxlnx)* | [github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Design taste protocols, minimalist UI, brutalist UI, typography and layout enforcement. |
| **Apple Platforms & Swift**<br>*(Dimillian)* | [github.com/Dimillian/Skills](https://github.com/Dimillian/Skills) | macOS menu bar apps, Tuist, SPM packaging, Swift concurrency, SwiftUI patterns. |
| **Context Engineering**<br>*(muratcankoylan)* | [github.com/muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Context compression, degradation defense, multi-agent coordination patterns. |
| **Curated Agent Skills Collection**<br>*(VoltAgent)* | [github.com/VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | Multi-agent coordination, testing tools, cloud patterns. |
| **Functional Programming**<br>*(whatiskadudoing)* | [github.com/whatiskadudoing/fp-ts-skills](https://github.com/whatiskadudoing/fp-ts-skills) | `fp-ts` pragmatic pipelines, TaskEither error handling, functional React. |
| **Scientific Computing & Bioinformatics**<br>*(K-Dense-AI)* | [github.com/K-Dense-AI/claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills) | NumPy, SciPy, Matplotlib, BioPython, Scanpy, PubMed querying. |
| **Workflow Automation (n8n)**<br>*(czlonkowski)* | [github.com/czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | n8n expression syntax, validation rules, MCP integration, subworkflows. |
| **UI Polish & Mobile Layouts**<br>*(ibelick)* | [github.com/ibelick/ui-skills](https://github.com/ibelick/ui-skills) | Opinionated UI constraints, accessibility fixes, motion performance. |
| **Three.js & WebGL 3D**<br>*(CloudAI-X)* | [github.com/CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) | Shaders, lighting, geometry, materials, post-processing. |
| **Security Testing & Web Fuzzing**<br>*(jthack)* | [github.com/jthack/ffuf_claude_skill](https://github.com/jthack/ffuf_claude_skill) | Web fuzzing with `ffuf`, parameter discovery. |
| **Vector CLI & Local Search**<br>*(scarletkc)* | [github.com/scarletkc/vexor](https://github.com/scarletkc/vexor) | Semantic file discovery using vector embeddings. |

---

## 4. How to Update or Fetch from These Sources

### Update Everything at Once
```powershell
# Run the built-in update script
.\scripts\update-skills.ps1
```

### Or Run the Commands Manually
```bash
# 1. Update the master AAS registry (covers Microsoft, Vercel, HF, Trail of Bits, etc.)
npx agentic-awesome-skills --antigravity --all

# 2. Update skills CLI tracked packages
npx skills update

# 3. Pull updates from any direct git clone (e.g. reverse-skill)
git -C <path-to-repo> pull
```
