const fs = require('fs');
const path = require('path');

const manifestPath = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.agent',
  'skills',
  '.antigravity-install-manifest.json'
);

if (!fs.existsSync(manifestPath)) {
  console.error('Manifest not found at:', manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const skills = (manifest.entries || []).slice().sort();

const catMap = [
  { name: 'Azure & Cloud Infrastructure', regex: /^(azure|aws|gcp|cloud)-/i },
  { name: 'Security, Penetration Testing & Red Teaming', regex: /^(hunt|security|pentest|audit|vulnerability|dast|sast|exploit|malware|reverse)-/i },
  { name: 'AI, LLMs, Agents & MCP', regex: /^(ai|agent|llm|mcp|prompt|rag|hugging|vector|langchain)-/i },
  { name: 'Frontend, UI/UX & Web Development', regex: /^(ui|frontend|design|tailwind|react|nextjs|vue|svelte|angular|astro)-/i },
  { name: 'Database, ORM & Storage Engineering', regex: /^(postgres|mysql|mongodb|redis|database|sql|drizzle|prisma|sqlite|libsql)-/i },
  { name: 'DevOps, Containers & CI/CD', regex: /^(docker|kubernetes|k8s|terraform|github|gitlab|helm|argocd|ansible|jenkins|circleci)-/i },
  { name: 'Mobile & Multi-platform (iOS, Android, Expo)', regex: /^(expo|android|ios|flutter|swiftui|react-native)-/i },
  { name: 'SEO & Generative Engine Optimization (GEO)', regex: /^(seo|geo)-/i },
  { name: 'Testing & Quality Assurance', regex: /^(tdd|test|e2e|playwright|jest|vitest|cypress|selenium)-/i },
  { name: 'Product Marketing, Copywriting & Psychology', regex: /^(marketing|analytics|psychologist|product|copywriting|pricing)-/i },
  { name: 'Language Specializations (Rust, Go, Python, C++, etc.)', regex: /^(rust|golang|go|python|fastapi|c-|cpp|csharp|dotnet|zig|php)-/i },
];

let doc = '# Installed Skills Registry & Update Guide\n\n';
doc += '> **Last Updated:** ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC  \n';
doc += '> **Total Skills Installed:** ' + skills.length.toLocaleString() + '  \n';
doc += '> **Global Storage Location:** `~/.agent/skills`  \n';
doc += '> **Workspace Symlink/Junction:** `.agent/skills`  \n';
doc += '> **Manifest File:** `~/.agent/skills/.antigravity-install-manifest.json`\n\n';
doc += '---\n\n';
doc += '## Quick Update Commands\n\n';
doc += 'To update your skills or install new ones, use the following `npx` commands directly in your terminal:\n\n';
doc += '### 1. Update All Skills to the Latest Versions\n';
doc += '```bash\n';
doc += '# Pulls latest revisions of all 2,687+ installed skills into ~/.agent/skills\n';
doc += 'npx agentic-awesome-skills --antigravity --all\n';
doc += '```\n\n';
doc += '### 2. Check for Updates First (Dry Run)\n';
doc += '```bash\n';
doc += '# Previews which skills have upstream changes without writing to disk\n';
doc += 'npx agentic-awesome-skills --antigravity --all --dry-run\n';
doc += '```\n\n';
doc += '### 3. Audit Local Skills Health\n';
doc += '```bash\n';
doc += '# Scans installed skills for missing files, invalid frontmatter, or broken links\n';
doc += 'npx agentic-awesome-skills audit\n';
doc += '```\n\n';
doc += '### 4. Install / Update Individual Skills via Skills CLI\n';
doc += '```bash\n';
doc += '# Search registry for a specific skill\n';
doc += 'npx skills search <skill-name>\n\n';
doc += '# Add or update a specific skill\n';
doc += 'npx skills add <skill-name>\n\n';
doc += '# Update all individually tracked skills\n';
doc += 'npx skills update\n';
doc += '```\n\n';
doc += '---\n\n';
doc += '## Category Breakdown\n\n';
doc += '| Category / Domain | Installed Count | Sample Skills |\n';
doc += '| :--- | :---: | :--- |\n';

catMap.forEach(({ name, regex }) => {
  const matched = skills.filter((s) => regex.test(s));
  const samples = matched.slice(0, 3).map((s) => '`' + s + '`').join(', ');
  doc += '| **' + name + '** | ' + matched.length + ' | ' + samples + ' |\n';
});

doc += '\n---\n\n';
doc += '## Helper Automation Scripts\n\n';
doc += 'We have provided a one-click PowerShell script at [`scripts/update-skills.ps1`](file:///d:/Python/Git_repos/axiom/scripts/update-skills.ps1). You can run:\n\n';
doc += '```powershell\n';
doc += '.\\scripts\\update-skills.ps1\n';
doc += '```\n\n';
doc += 'Options supported by the script:\n';
doc += '- `.\\scripts\\update-skills.ps1 -DryRun` : Previews updates without modifying files.\n';
doc += '- `.\\scripts\\update-skills.ps1 -Audit` : Runs the integrity audit.\n';
doc += '- `.\\scripts\\update-skills.ps1` : Performs full synchronization and updates the manifest.\n\n';
doc += '---\n\n';
doc += '## Complete Installed Skills Directory (' + skills.length.toLocaleString() + ' Total)\n\n';
doc += '<details>\n';
doc += '<summary><strong>Click to expand the full list of all ' + skills.length + ' skills</strong></summary>\n\n';
doc += '<br />\n\n';
doc += '| # | Skill Name | # | Skill Name | # | Skill Name |\n';
doc += '| :--- | :--- | :--- | :--- | :--- | :--- |\n';

const rows = Math.ceil(skills.length / 3);
for (let i = 0; i < rows; i++) {
  const s1 = skills[i] || '';
  const idx1 = s1 ? i + 1 : '';
  const s2 = skills[i + rows] || '';
  const idx2 = s2 ? i + rows + 1 : '';
  const s3 = skills[i + rows * 2] || '';
  const idx3 = s3 ? i + rows * 2 + 1 : '';

  doc += '| ' + idx1 + ' | ' + (s1 ? '`' + s1 + '`' : '') + ' | ' + idx2 + ' | ' + (s2 ? '`' + s2 + '`' : '') + ' | ' + idx3 + ' | ' + (s3 ? '`' + s3 + '`' : '') + ' |\n';
}

doc += '\n</details>\n';

const outputPath = path.join(__dirname, '..', 'docs', 'reference', 'skills-registry.md');
fs.writeFileSync(outputPath, doc, 'utf8');

const agentCopyPath = path.join(__dirname, '..', '.agent', 'SKILLS_REGISTRY.md');
fs.writeFileSync(agentCopyPath, doc, 'utf8');

console.log('Successfully wrote skills registry to:', outputPath);
console.log('Successfully wrote copy to:', agentCopyPath);
