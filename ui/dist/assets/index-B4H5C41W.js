(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const n of o.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&a(n)}).observe(document,{childList:!0,subtree:!0});function e(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function a(s){if(s.ep)return;s.ep=!0;const o=e(s);fetch(s.href,o)}})();class E{getHeaders(){const t={"Content-Type":"application/json",Accept:"application/json"},e=localStorage.getItem("axiom_session_token");return e&&(t.Authorization=`Bearer ${e}`),t}async request(t,e={}){const a=t.startsWith("/")?t:`/${t}`,s=await fetch(a,{...e,headers:{...this.getHeaders(),...e.headers||{}}});if(s.status===401&&!window.location.hash.includes("#/login")&&!window.location.hash.includes("#/setup")&&(localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username"),window.location.hash="#/login"),(s.headers.get("content-type")||"").includes("text/plain")){const r=await s.text();if(!s.ok)throw new Error(r||`HTTP ${s.status}`);return r}const n=await s.json();if(!n.success&&n.error)throw new Error(n.error.message||n.error.code||"API error");return n.data}async checkSetupStatus(){return this.request("/admin/v1/setup/begin",{method:"POST"})}async createAdminAccount(t){return this.request("/admin/v1/setup/account",{method:"POST",body:JSON.stringify(t)})}async setupDatabase(t){return this.request("/admin/v1/setup/database",{method:"POST",body:JSON.stringify(t)})}async completeSetup(){return this.request("/admin/v1/setup/complete",{method:"POST"})}async login(t){return this.request("/admin/v1/auth/login",{method:"POST",body:JSON.stringify(t)})}async logout(){try{await this.request("/admin/v1/auth/logout",{method:"POST"})}finally{localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username")}}async getStatus(){return this.request("/admin/v1/status")}async getDatabases(){return this.request("/admin/v1/databases")}async addDatabase(t){return this.request("/admin/v1/databases",{method:"POST",body:JSON.stringify(t)})}async deleteDatabase(t){return this.request(`/admin/v1/databases/${encodeURIComponent(t)}`,{method:"DELETE"})}async getKeys(){return this.request("/admin/v1/keys")}async createKey(t){return this.request("/admin/v1/keys",{method:"POST",body:JSON.stringify(t)})}async deleteKey(t){return this.request(`/admin/v1/keys/${encodeURIComponent(t)}`,{method:"DELETE"})}async getRoles(){return this.request("/admin/v1/roles")}async createRole(t){return this.request("/admin/v1/roles",{method:"POST",body:JSON.stringify(t)})}async updateRole(t,e){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"PATCH",body:JSON.stringify(e)})}async deleteRole(t){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"DELETE"})}async getCacheStats(){return this.request("/admin/v1/cache/stats")}async flushCache(){return this.request("/admin/v1/cache/flush",{method:"POST"})}async getAuditLog(t=100,e=0){return this.request(`/admin/v1/audit?limit=${t}&offset=${e}`)}async getRawMetrics(){return this.request("/metrics")}}const b=new E;function l(u,t="w-4 h-4"){const e=`class="${t} inline-block" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"`;switch(u){case"dashboard":return`<svg ${e}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;case"database":return`<svg ${e}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;case"key":return`<svg ${e}><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`;case"shield":return`<svg ${e}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`;case"hard-drive":return`<svg ${e}><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>`;case"file-text":return`<svg ${e}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;case"activity":return`<svg ${e}><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2"/></svg>`;case"server":return`<svg ${e}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;case"plus":return`<svg ${e}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;case"trash":return`<svg ${e}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;case"refresh":return`<svg ${e}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`;case"copy":return`<svg ${e}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;case"check":return`<svg ${e}><path d="M20 6 9 17l-5-5"/></svg>`;case"logout":return`<svg ${e}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;case"menu":return`<svg ${e}><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;case"x":return`<svg ${e}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;default:return`<svg ${e}><circle cx="12" cy="12" r="10"/></svg>`}}function L(u){const t=localStorage.getItem("axiom_username")||"admin";return setTimeout(()=>{document.getElementById("mobile-menu-btn")?.addEventListener("click",u),document.getElementById("logout-btn")?.addEventListener("click",async()=>{await b.logout(),window.location.hash="#/login"})},0),`
    <header class="h-14 border-b border-surfaceBorder bg-surface px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      <div class="flex items-center space-x-3">
        <button 
          id="mobile-menu-btn" 
          aria-label="Open Navigation Menu"
          class="lg:hidden p-2 text-secondary hover:text-primary hover:bg-surfaceHover rounded-md transition-colors"
        >
          ${l("menu","w-5 h-5")}
        </button>

        <a href="#/overview" class="flex items-center space-x-2.5">
          <div class="w-6 h-6 rounded bg-accent-orange text-white flex items-center justify-center font-bold text-xs tracking-wider">
            AX
          </div>
          <span class="font-semibold text-sm text-primary tracking-tight">Axiom</span>
          <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-surfaceHover text-secondary border border-surfaceBorder">v4.0</span>
        </a>
      </div>

      <div class="flex items-center space-x-4">
        <!-- Live Gateway Status Pill -->
        <div class="hidden sm:flex items-center space-x-1.5 text-xs text-secondary bg-background px-2.5 py-1 rounded-full border border-surfaceBorder">
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Gateway Online</span>
        </div>

        <!-- User profile & Logout -->
        <div class="flex items-center space-x-2 text-xs">
          <span class="text-secondary font-mono">${t}</span>
          <button 
            id="logout-btn" 
            title="Sign out"
            class="p-1.5 text-secondary hover:text-red-400 hover:bg-surfaceHover rounded-md transition-colors"
          >
            ${l("logout","w-4 h-4")}
          </button>
        </div>
      </div>
    </header>
  `}const I=[{id:"overview",label:"Overview",iconName:"dashboard",hash:"#/overview"},{id:"databases",label:"Databases",iconName:"database",hash:"#/databases"},{id:"keys",label:"API Keys",iconName:"key",hash:"#/keys"},{id:"roles",label:"Roles & RBAC",iconName:"shield",hash:"#/roles"},{id:"cache",label:"Cache Engine",iconName:"hard-drive",hash:"#/cache"},{id:"logs",label:"Live Logs",iconName:"file-text",hash:"#/logs"},{id:"audit",label:"Audit Trail",iconName:"file-text",hash:"#/audit"},{id:"metrics",label:"Metrics",iconName:"activity",hash:"#/metrics"},{id:"system",label:"System",iconName:"server",hash:"#/system"}];function S(u,t,e){setTimeout(()=>{document.getElementById("sidebar-backdrop")?.addEventListener("click",e)},0);const a=I.map(s=>{const o=u===s.id,n=o?"bg-surfaceBorder text-primary font-medium border-l-2 border-accent-orange":"text-secondary hover:text-primary hover:bg-surfaceHover border-l-2 border-transparent";return`
      <a 
        href="${s.hash}" 
        class="flex items-center space-x-3 px-3 py-2.5 rounded-r-md text-xs transition-colors duration-150 ${n}"
      >
        <span class="${o?"text-accent-orange":"text-secondary"}">
          ${l(s.iconName,"w-4 h-4")}
        </span>
        <span>${s.label}</span>
      </a>
    `}).join("");return`
    <!-- Mobile Backdrop Drawer Overlay -->
    <div 
      id="sidebar-backdrop" 
      class="fixed inset-0 bg-black/60 z-30 transition-opacity lg:hidden ${t?"block":"hidden"}"
    ></div>

    <!-- Sidebar Container -->
    <aside 
      class="fixed inset-y-0 left-0 z-40 w-64 bg-surface border-r border-surfaceBorder transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${t?"translate-x-0":"-translate-x-full"}"
    >
      <div class="h-14 border-b border-surfaceBorder px-4 flex items-center justify-between lg:hidden">
        <span class="text-xs font-semibold text-primary">Menu</span>
        <button id="sidebar-close-btn" class="p-1 text-secondary hover:text-primary">
          ${l("x","w-5 h-5")}
        </button>
      </div>

      <div class="p-3 space-y-1">
        <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary/60">
          Gateway Control
        </div>
        ${a}
      </div>

      <div class="absolute bottom-0 inset-x-0 p-4 border-t border-surfaceBorder bg-surface">
        <div class="text-[11px] text-secondary space-y-1 font-mono">
          <div class="flex items-center justify-between">
            <span>Status</span>
            <span class="text-emerald-400">Ready</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Engine</span>
            <span>Axiom v4.0</span>
          </div>
        </div>
      </div>
    </aside>
  `}function $(u){let t=1,e="",a="",s="",o="",n="postgres",r="";function d(){u.innerHTML=`
      <div class="min-h-screen flex items-center justify-center p-4 bg-background">
        <div class="w-full max-w-lg bg-surface border border-borderDefault rounded-lg p-6 sm:p-8 shadow-sm">
          
          <!-- Stepper Indicator -->
          <div class="flex items-center justify-between mb-8 border-b border-surfaceBorder pb-4">
            <div class="flex items-center space-x-2">
              <div class="w-7 h-7 rounded-md bg-accent-orange text-white flex items-center justify-center font-bold text-xs">
                AX
              </div>
              <span class="text-sm font-semibold text-primary">Axiom Setup Wizard</span>
            </div>
            <div class="text-xs text-secondary font-mono">
              Step ${t} of 4
            </div>
          </div>

          <div id="setup-error" class="hidden mb-4 p-3 rounded-md bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

          ${i()}

        </div>
      </div>
    `,c()}function i(){switch(t){case 1:return`
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-primary">Welcome to Axiom Gateway</h2>
            <p class="text-xs text-secondary leading-relaxed">
              Axiom is an enterprise-grade SQL API gateway that unifies database connectivity, 
              RBAC authorization, high-speed L1/L2 caching, and Model Context Protocol (MCP) into a single binary.
            </p>
            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs text-secondary">
              <div class="flex items-center space-x-2 text-primary font-medium">
                ${l("shield","w-4 h-4 text-accent-orange")}
                <span>What we will configure:</span>
              </div>
              <ul class="list-disc pl-5 space-y-1 text-secondary">
                <li>Create the primary human administrative account.</li>
                <li>Connect your first SQL database (PostgreSQL, MySQL, SQLite, MSSQL, or ClickHouse).</li>
                <li>Initialize the cryptographic metadata store (<code class="text-primary font-mono">axiom.db</code>).</li>
              </ul>
            </div>
            <button id="step1-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Begin Configuration
            </button>
          </div>
        `;case 2:return`
          <form id="step2-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Create Primary Admin</h2>
              <p class="text-xs text-secondary">This account manages the Web UI console and operator policies.</p>
            </div>

            <div>
              <label for="admin-user" class="block text-xs font-medium text-secondary mb-1">Admin Username</label>
              <input 
                id="admin-user" 
                type="text" 
                required 
                placeholder="admin"
                value="${e}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <div>
              <label for="admin-pass" class="block text-xs font-medium text-secondary mb-1">Master Password</label>
              <input 
                id="admin-pass" 
                type="password" 
                required 
                minlength="8"
                placeholder="Minimum 8 characters"
                value="${a}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <button type="submit" id="step2-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Continue to Database Setup
            </button>
          </form>
        `;case 3:return`
          <form id="step3-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Connect First Database</h2>
              <p class="text-xs text-secondary">Register a target database connection. You can also skip this and add databases later.</p>
            </div>

            <div>
              <label for="db-alias" class="block text-xs font-medium text-secondary mb-1">Database Alias</label>
              <input 
                id="db-alias" 
                type="text" 
                placeholder="main_db"
                value="${s}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="db-engine" class="block text-xs font-medium text-secondary mb-1">Engine Dialect</label>
                <select 
                  id="db-engine"
                  class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
                >
                  <option value="postgres" ${n==="postgres"?"selected":""}>PostgreSQL</option>
                  <option value="mysql" ${n==="mysql"?"selected":""}>MySQL / MariaDB</option>
                  <option value="sqlite" ${n==="sqlite"?"selected":""}>SQLite / LibSQL</option>
                  <option value="mssql" ${n==="mssql"?"selected":""}>Microsoft SQL Server</option>
                  <option value="clickhouse" ${n==="clickhouse"?"selected":""}>ClickHouse</option>
                </select>
              </div>
              <div>
                <label for="pool-size" class="block text-xs font-medium text-secondary mb-1">Max Pool Size</label>
                <input 
                  id="pool-size" 
                  type="number" 
                  value="10" 
                  class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
                />
              </div>
            </div>

            <div>
              <label for="db-url" class="block text-xs font-medium text-secondary mb-1">Connection URL</label>
              <input 
                id="db-url" 
                type="text" 
                placeholder="postgres://user:pass@localhost:5432/mydb"
                value="${o}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing font-mono text-xs"
              />
            </div>

            <div class="flex space-x-3 pt-2">
              <button type="button" id="step3-skip" class="flex-1 py-2.5 px-4 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary text-sm font-medium rounded-md transition-colors">
                Skip for Now
              </button>
              <button type="submit" id="step3-next" class="flex-1 py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
                Save & Continue
              </button>
            </div>
          </form>
        `;case 4:return`
          <div class="space-y-4">
            <div class="text-center py-4">
              <div class="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center mb-3">
                ${l("check","w-6 h-6")}
              </div>
              <h2 class="text-xl font-semibold text-primary">Setup Complete!</h2>
              <p class="text-xs text-secondary mt-1">Axiom Gateway is initialized and the wizard is now permanently locked.</p>
            </div>

            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs">
              <div class="text-secondary font-medium">Session Token:</div>
              <div class="flex items-center justify-between bg-surface p-2 rounded border border-surfaceBorder font-mono text-[11px] text-primary overflow-x-auto">
                <span>${r||"Active Session Established"}</span>
              </div>
            </div>

            <button id="step4-finish" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors">
              Launch Dashboard
            </button>
          </div>
        `;default:return""}}function c(){const y=document.getElementById("setup-error");t===1?document.getElementById("step1-next")?.addEventListener("click",()=>{t=2,d()}):t===2?document.getElementById("step2-form")?.addEventListener("submit",async x=>{x.preventDefault(),e=document.getElementById("admin-user").value.trim(),a=document.getElementById("admin-pass").value;const p=document.getElementById("step2-next");p.disabled=!0,p.textContent="Creating Account...";try{const m=await b.createAdminAccount({username:e,password:a});r=m.token,localStorage.setItem("axiom_session_token",m.token),localStorage.setItem("axiom_username",m.username),t=3,d()}catch(m){y.textContent=m instanceof Error?m.message:"Account creation failed",y.classList.remove("hidden"),p.disabled=!1,p.textContent="Continue to Database Setup"}}):t===3?(document.getElementById("step3-skip")?.addEventListener("click",async()=>{try{await b.completeSetup(),t=4,d()}catch{t=4,d()}}),document.getElementById("step3-form")?.addEventListener("submit",async x=>{if(x.preventDefault(),s=document.getElementById("db-alias").value.trim(),n=document.getElementById("db-engine").value,o=document.getElementById("db-url").value.trim(),s&&o)try{await b.setupDatabase({alias:s,url:o,engine:n})}catch(p){y.textContent=p instanceof Error?p.message:"Failed to register database",y.classList.remove("hidden");return}try{await b.completeSetup()}catch{}t=4,d()})):t===4&&document.getElementById("step4-finish")?.addEventListener("click",()=>{window.location.hash="#/overview"})}d()}function C(u){u.innerHTML=`
    <div class="min-h-screen flex items-center justify-center p-4 bg-background">
      <div class="w-full max-w-sm bg-surface border border-borderDefault rounded-lg p-6 sm:p-8 shadow-sm">
        <div class="flex items-center space-x-3 mb-6">
          <div class="w-8 h-8 rounded-md bg-accent-orange flex items-center justify-center font-bold text-white tracking-wider">
            AX
          </div>
          <div>
            <h1 class="text-lg font-semibold text-primary">Axiom Gateway</h1>
            <p class="text-xs text-secondary">Administrative Console</p>
          </div>
        </div>

        <div id="login-error" class="hidden mb-4 p-3 rounded-md bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="login-form" class="space-y-4">
          <div>
            <label for="username" class="block text-xs font-medium text-secondary mb-1">Username</label>
            <input 
              id="username" 
              name="username" 
              type="text" 
              required 
              autocomplete="username"
              placeholder="admin"
              class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary placeholder:text-secondary/50 focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-medium text-secondary mb-1">Password</label>
            <input 
              id="password" 
              name="password" 
              type="password" 
              required 
              autocomplete="current-password"
              placeholder="••••••••••••"
              class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary placeholder:text-secondary/50 focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing"
            />
          </div>

          <button 
            type="submit" 
            id="login-btn"
            class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-medium rounded-md transition-colors duration-150 flex items-center justify-center"
          >
            <span>Sign In</span>
          </button>
        </form>
      </div>
    </div>
  `;const t=document.getElementById("login-form"),e=document.getElementById("login-error"),a=document.getElementById("login-btn");t.addEventListener("submit",async s=>{s.preventDefault(),e.classList.add("hidden"),e.textContent="",a.disabled=!0,a.innerHTML="<span>Verifying...</span>";const o=document.getElementById("username").value.trim(),n=document.getElementById("password").value;try{const r=await b.login({username:o,password:n});localStorage.setItem("axiom_session_token",r.token),localStorage.setItem("axiom_username",r.username),window.location.hash="#/overview"}catch(r){e.textContent=r instanceof Error?r.message:"Invalid credentials",e.classList.remove("hidden")}finally{a.disabled=!1,a.innerHTML="<span>Sign In</span>"}})}async function B(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Overview</h1>
          <p class="text-xs text-secondary mt-0.5">Real-time gateway status and system health.</p>
        </div>
        <button id="refresh-overview" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
          ${l("refresh","w-3.5 h-3.5")}
          <span>Refresh</span>
        </button>
      </div>

      <!-- Stat Cards Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">Databases</span>
            ${l("database","w-4 h-4 text-accent-blue")}
          </div>
          <div id="stat-dbs" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Configured connection pools</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">API Keys</span>
            ${l("key","w-4 h-4 text-accent-orange")}
          </div>
          <div id="stat-keys" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Active client credentials</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">Cache Hit Rate</span>
            ${l("hard-drive","w-4 h-4 text-emerald-400")}
          </div>
          <div id="stat-cache-rate" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div id="stat-cache-entries" class="text-[11px] text-secondary mt-1">0 active entries</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium">System Uptime</span>
            ${l("activity","w-4 h-4 text-purple-400")}
          </div>
          <div id="stat-uptime" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div id="stat-mem" class="text-[11px] text-secondary mt-1">Memory RSS: — MB</div>
        </div>
      </div>

      <!-- Quick Actions & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Quick Actions -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <h2 class="text-sm font-semibold text-primary">Quick Actions</h2>
          <div class="space-y-2">
            <a href="#/databases" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-blue/10 text-accent-blue">${l("database","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Connect Database</div>
                  <div class="text-[11px] text-secondary">Add PostgreSQL, MySQL, SQLite, MSSQL</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>

            <a href="#/keys" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-orange/10 text-accent-orange">${l("key","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Create API Key</div>
                  <div class="text-[11px] text-secondary">Generate secure machine token</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>

            <a href="#/cache" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-emerald-500/10 text-emerald-400">${l("hard-drive","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange">Inspect Cache</div>
                  <div class="text-[11px] text-secondary">L1 RAM & L2 disk persistence</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary">&rarr;</span>
            </a>
          </div>
        </div>

        <!-- Recent Audit Log Activity -->
        <div class="lg:col-span-2 bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-primary">Recent Control Plane Activity</h2>
            <a href="#/audit" class="text-xs text-accent-orange hover:underline">View all</a>
          </div>

          <div id="overview-audit-list" class="space-y-2">
            <div class="text-xs text-secondary py-4 text-center">Loading audit log...</div>
          </div>
        </div>
      </div>
    </div>
  `;async function t(){try{const[e,a,s]=await Promise.all([b.getStatus().catch(()=>null),b.getCacheStats().catch(()=>null),b.getAuditLog(5,0).catch(()=>[])]);if(e){document.getElementById("stat-dbs").textContent=String(e.active_databases),document.getElementById("stat-keys").textContent=String(e.registered_keys);const n=Math.floor(e.uptime_seconds/60),r=n<60?`${n}m`:`${Math.floor(n/60)}h ${n%60}m`;document.getElementById("stat-uptime").textContent=r,document.getElementById("stat-mem").textContent=`Memory RSS: ${e.memory_mb} MB | CPU: ${e.cpu_percent.toFixed(1)}%`}if(a){const n=a.hits_l1+a.hits_l2,r=n+a.misses,d=r>0?(n/r*100).toFixed(1):"0.0";document.getElementById("stat-cache-rate").textContent=`${d}%`,document.getElementById("stat-cache-entries").textContent=`${a.entries_count} L1 cached entries`}const o=document.getElementById("overview-audit-list");s&&s.length>0?o.innerHTML=s.map(n=>`
          <div class="flex items-center justify-between py-2 px-3 rounded bg-background border border-surfaceBorder text-xs">
            <div class="flex items-center space-x-2">
              <span class="font-mono text-accent-orange font-semibold">${n.action}</span>
              <span class="text-primary">${n.target}</span>
              ${n.details?`<span class="text-secondary text-[11px]">(${n.details})</span>`:""}
            </div>
            <div class="text-secondary text-[11px] font-mono">
              ${new Date(n.timestamp*1e3).toLocaleTimeString()}
            </div>
          </div>
        `).join(""):o.innerHTML='<div class="text-xs text-secondary py-4 text-center">No recent audit log entries recorded.</div>'}catch{}}document.getElementById("refresh-overview")?.addEventListener("click",t),t()}async function R(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Databases</h1>
          <p class="text-xs text-secondary mt-0.5">Manage live database connection pools and dialects.</p>
        </div>
        <button id="open-add-db-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors">
          ${l("plus","w-3.5 h-3.5")}
          <span>Connect Database</span>
        </button>
      </div>

      <!-- Databases Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Alias</th>
                <th class="py-3 px-4">Engine Dialect</th>
                <th class="py-3 px-4">Pool Bounds</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="db-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="5" class="py-8 text-center text-secondary">Loading registered databases...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Add Database Modal -->
    <div id="add-db-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Connect New Database</h2>
          <button id="close-add-db-modal" class="text-secondary hover:text-primary">
            ${l("x","w-4 h-4")}
          </button>
        </div>

        <div id="modal-error" class="hidden p-2 rounded bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="add-db-form" class="space-y-3 text-xs">
          <div>
            <label class="block text-secondary mb-1">Database Alias</label>
            <input id="new-db-alias" type="text" required placeholder="e.g. analytics_db" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">Engine Dialect</label>
            <select id="new-db-engine" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none">
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite / LibSQL</option>
              <option value="mssql">Microsoft SQL Server</option>
              <option value="clickhouse">ClickHouse</option>
            </select>
          </div>

          <div>
            <label class="block text-secondary mb-1">Connection URL</label>
            <input id="new-db-url" type="text" required placeholder="postgres://user:pass@localhost:5432/dbname" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono text-xs focus:border-focusRing focus:outline-none" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-secondary mb-1">Min Pool</label>
              <input id="new-db-min" type="number" value="1" min="1" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
            </div>
            <div>
              <label class="block text-secondary mb-1">Max Pool</label>
              <input id="new-db-max" type="number" value="10" min="1" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-3">
            <button type="button" id="cancel-add-db" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary rounded-md">Cancel</button>
            <button type="submit" id="submit-add-db" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md">Connect</button>
          </div>
        </form>
      </div>
    </div>
  `;const t=document.getElementById("add-db-modal"),e=document.getElementById("modal-error");async function a(){const o=document.getElementById("db-table-body");try{const n=await b.getDatabases();if(n.length===0){o.innerHTML=`
          <tr>
            <td colspan="5" class="py-8 text-center text-secondary">
              No databases connected yet. Click "Connect Database" to add one.
            </td>
          </tr>
        `;return}o.innerHTML=n.map(r=>`
        <tr class="hover:bg-surfaceHover/50 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${r.alias}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
              ${r.engine}
            </span>
          </td>
          <td class="py-3 px-4 text-secondary">${r.pool_min} / ${r.pool_max} conns</td>
          <td class="py-3 px-4 text-secondary">${new Date(r.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-alias="${r.alias}" class="p-1 text-secondary hover:text-red-400 rounded hover:bg-surfaceHover transition-colors" title="Delete connection">
              ${l("trash","w-4 h-4")}
            </button>
          </td>
        </tr>
      `).join(""),o.querySelectorAll("[data-delete-alias]").forEach(r=>{r.addEventListener("click",async d=>{const i=d.currentTarget.getAttribute("data-delete-alias");if(i&&confirm(`Are you sure you want to disconnect database '${i}'?`))try{await b.deleteDatabase(i),a()}catch(c){alert(c instanceof Error?c.message:"Failed to delete")}})})}catch{o.innerHTML='<tr><td colspan="5" class="py-8 text-center text-red-400">Failed to load databases.</td></tr>'}}document.getElementById("open-add-db-modal")?.addEventListener("click",()=>{e.classList.add("hidden"),t.classList.remove("hidden")});const s=()=>t.classList.add("hidden");document.getElementById("close-add-db-modal")?.addEventListener("click",s),document.getElementById("cancel-add-db")?.addEventListener("click",s),document.getElementById("add-db-form")?.addEventListener("submit",async o=>{o.preventDefault(),e.classList.add("hidden");const n=document.getElementById("new-db-alias").value.trim(),r=document.getElementById("new-db-engine").value,d=document.getElementById("new-db-url").value.trim(),i=parseInt(document.getElementById("new-db-min").value,10)||1,c=parseInt(document.getElementById("new-db-max").value,10)||10,y=document.getElementById("submit-add-db");y.disabled=!0,y.textContent="Connecting...";try{await b.addDatabase({alias:n,engine:r,url:d,pool_min:i,pool_max:c}),s(),a()}catch(x){e.textContent=x instanceof Error?x.message:"Failed to add database",e.classList.remove("hidden")}finally{y.disabled=!1,y.textContent="Connect"}}),a()}async function M(u){let t=[];u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">API Keys</h1>
          <p class="text-xs text-secondary mt-0.5">Manage application credentials and granular role assignments.</p>
        </div>
        <button id="open-create-key-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors">
          ${l("plus","w-3.5 h-3.5")}
          <span>Create Key</span>
        </button>
      </div>

      <!-- Keys Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Key Identifier</th>
                <th class="py-3 px-4">Assigned Role</th>
                <th class="py-3 px-4">Rate Limit</th>
                <th class="py-3 px-4">Expires</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="keys-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading API keys...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Key Modal -->
    <div id="create-key-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Generate API Key</h2>
          <button id="close-create-key-modal" class="text-secondary hover:text-primary">
            ${l("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2 rounded bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="create-key-form" class="space-y-3 text-xs">
          <div>
            <label class="block text-secondary mb-1">Key Name / Identifier</label>
            <input id="key-name-input" type="text" required placeholder="e.g. backend-microservice" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">RBAC Role</label>
            <select id="key-role-select" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none">
              <option value="">No Role (Unrestricted or Legacy)</option>
            </select>
          </div>

          <div>
            <label class="block text-secondary mb-1">Rate Limit Override (req/min, 0 = global default)</label>
            <input id="key-rate-input" type="number" value="0" min="0" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">Custom Secret (optional, auto-generated if blank)</label>
            <input id="key-secret-input" type="password" placeholder="Leave empty for secure random UUID" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <div class="flex justify-end space-x-2 pt-3">
            <button type="button" id="cancel-create-key" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary rounded-md">Cancel</button>
            <button type="submit" id="submit-create-key" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md">Generate Key</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-lg">
        <div class="flex items-center space-x-2 text-accent-orange">
          ${l("shield","w-5 h-5")}
          <h2 class="text-sm font-semibold text-primary">Save Your API Key Credentials</h2>
        </div>
        <p class="text-xs text-secondary">
          This is the ONLY time the key secret will ever be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Token Header Value (Base64)</label>
            <div class="flex items-center space-x-2 bg-background border border-surfaceBorder rounded-md p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-primary text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="p-1 text-secondary hover:text-primary rounded hover:bg-surfaceHover">
                ${l("copy","w-4 h-4")}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Example cURL Query</label>
            <div class="bg-background border border-surfaceBorder rounded-md p-2.5 font-mono text-[11px] text-secondary overflow-x-auto relative group">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full py-2 bg-accent-orange hover:bg-orange-600 text-white text-xs font-medium rounded-md">
          I Have Saved This Key
        </button>
      </div>
    </div>
  `;const e=document.getElementById("create-key-modal"),a=document.getElementById("secret-modal"),s=document.getElementById("create-key-error");async function o(){try{t=await b.getRoles();const d=document.getElementById("key-role-select");d.innerHTML='<option value="">No Role (Unrestricted / Superadmin)</option>'+t.map(i=>`<option value="${i.name}">${i.name} (${i.permissions.length} perms)</option>`).join("")}catch{}}async function n(){const d=document.getElementById("keys-table-body");try{const i=await b.getKeys();if(i.length===0){d.innerHTML='<tr><td colspan="6" class="py-8 text-center text-secondary">No API keys registered yet.</td></tr>';return}d.innerHTML=i.map(c=>`
        <tr class="hover:bg-surfaceHover/50 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${c.name}</td>
          <td class="py-3 px-4">
            ${c.role_name?`<span class="px-2 py-0.5 rounded text-[11px] bg-accent-orange/10 text-accent-orange border border-accent-orange/20">${c.role_name}</span>`:'<span class="text-secondary text-[11px]">none</span>'}
          </td>
          <td class="py-3 px-4 text-secondary">${c.rate_limit>0?`${c.rate_limit} req/min`:"global"}</td>
          <td class="py-3 px-4 text-secondary">${c.expires_at?new Date(c.expires_at*1e3).toLocaleDateString():"never"}</td>
          <td class="py-3 px-4 text-secondary">${new Date(c.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-key="${c.name}" class="p-1 text-secondary hover:text-red-400 rounded hover:bg-surfaceHover transition-colors" title="Revoke API key">
              ${l("trash","w-4 h-4")}
            </button>
          </td>
        </tr>
      `).join(""),d.querySelectorAll("[data-delete-key]").forEach(c=>{c.addEventListener("click",async y=>{const x=y.currentTarget.getAttribute("data-delete-key");if(x&&confirm(`Revoke API key '${x}' immediately?`))try{await b.deleteKey(x),n()}catch(p){alert(p instanceof Error?p.message:"Failed to delete")}})})}catch{d.innerHTML='<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load API keys.</td></tr>'}}document.getElementById("open-create-key-modal")?.addEventListener("click",()=>{s.classList.add("hidden"),e.classList.remove("hidden")});const r=()=>e.classList.add("hidden");document.getElementById("close-create-key-modal")?.addEventListener("click",r),document.getElementById("cancel-create-key")?.addEventListener("click",r),document.getElementById("close-secret-modal")?.addEventListener("click",()=>{a.classList.add("hidden")}),document.getElementById("copy-token-btn")?.addEventListener("click",()=>{const d=document.getElementById("secret-token-display");navigator.clipboard.writeText(d.value),alert("Token copied to clipboard!")}),document.getElementById("create-key-form")?.addEventListener("submit",async d=>{d.preventDefault(),s.classList.add("hidden");const i=document.getElementById("key-name-input").value.trim(),c=document.getElementById("key-role-select").value,y=parseInt(document.getElementById("key-rate-input").value,10)||0,x=document.getElementById("key-secret-input").value.trim()||void 0,p=document.getElementById("submit-create-key");p.disabled=!0,p.textContent="Generating...";try{const m=await b.createKey({name:i,role:c||void 0,rate_limit:y,secret:x});r(),n(),document.getElementById("secret-token-display").value=m.token_header,document.getElementById("secret-curl-display").textContent=`curl -X POST http://localhost:4500/api/v1/db/main_db/query \\
  -H "X-Axiom-Key: ${m.token_header}" \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT 1;"}'`,a.classList.remove("hidden")}catch(m){s.textContent=m instanceof Error?m.message:"Failed to create key",s.classList.remove("hidden")}finally{p.disabled=!1,p.textContent="Generate Key"}}),await o(),n()}async function A(u){let t=[];u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Roles & Policies</h1>
          <p class="text-xs text-secondary mt-0.5">Define access control policies and permission grants.</p>
        </div>
        <button id="open-create-role-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors">
          ${l("plus","w-3.5 h-3.5")}
          <span>Create Role</span>
        </button>
      </div>

      <!-- Roles Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Role Name</th>
                <th class="py-3 px-4">Description</th>
                <th class="py-3 px-4">Permission Grants</th>
                <th class="py-3 px-4">Created</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="roles-table-body" class="divide-y divide-surfaceBorder">
              <tr>
                <td colspan="5" class="py-8 text-center text-secondary">Loading roles...</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Role Modal -->
    <div id="create-role-modal" class="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-lg max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Create Access Role</h2>
          <button id="close-create-role-modal" class="text-secondary hover:text-primary">
            ${l("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-role-error" class="hidden p-2 rounded bg-accent-danger/10 border border-accent-danger/30 text-xs text-red-400"></div>

        <form id="create-role-form" class="space-y-4 text-xs">
          <div>
            <label class="block text-secondary mb-1">Role Name</label>
            <input id="role-name-input" type="text" required placeholder="e.g. read_only_analyst" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono focus:border-focusRing focus:outline-none" />
          </div>

          <div>
            <label class="block text-secondary mb-1">Description</label>
            <input id="role-desc-input" type="text" placeholder="Read-only access to customer analytics" class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" />
          </div>

          <!-- Permission Rule Builder -->
          <div class="border border-surfaceBorder rounded-md p-3 bg-background space-y-3">
            <div class="font-medium text-primary text-xs">Add Permission Grant</div>
            
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-secondary text-[11px] mb-1">Database (* = all)</label>
                <input id="perm-db-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
              <div>
                <label class="block text-secondary text-[11px] mb-1">Table (* = all)</label>
                <input id="perm-table-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
            </div>

            <div>
              <label class="block text-secondary text-[11px] mb-1">Allowed Operations</label>
              <div class="flex items-center space-x-4 pt-1 font-mono">
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-select" checked class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">SELECT</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-insert" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">INSERT</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-update" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">UPDATE</span>
                </label>
                <label class="flex items-center space-x-1.5 cursor-pointer">
                  <input type="checkbox" id="op-delete" class="rounded border-surfaceBorder text-accent-orange focus:ring-0" />
                  <span class="text-primary text-[11px]">DELETE</span>
                </label>
              </div>
            </div>

            <button type="button" id="add-perm-rule-btn" class="w-full py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded text-xs transition-colors">
              + Add Rule to Role
            </button>

            <!-- Pending Rules List -->
            <div id="pending-rules-container" class="space-y-1.5 pt-2 border-t border-surfaceBorder">
              <div class="text-[11px] text-secondary">No rules added yet.</div>
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-2">
            <button type="button" id="cancel-create-role" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary rounded-md">Cancel</button>
            <button type="submit" id="submit-create-role" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md">Save Role</button>
          </div>
        </form>
      </div>
    </div>
  `;const e=document.getElementById("create-role-modal"),a=document.getElementById("create-role-error");function s(){const r=document.getElementById("pending-rules-container");if(t.length===0){r.innerHTML='<div class="text-[11px] text-secondary">No rules added yet.</div>';return}r.innerHTML=t.map((d,i)=>`
      <div class="flex items-center justify-between p-2 rounded bg-surface border border-surfaceBorder text-[11px] font-mono">
        <div>
          <span class="text-accent-blue">${d.database}</span>.<span class="text-primary">${d.table_name}</span> &rarr;
          <span class="text-accent-orange font-semibold">[${d.operations.join(", ")}]</span>
        </div>
        <button type="button" data-remove-rule="${i}" class="text-secondary hover:text-red-400 p-0.5">
          ${l("x","w-3.5 h-3.5")}
        </button>
      </div>
    `).join(""),r.querySelectorAll("[data-remove-rule]").forEach(d=>{d.addEventListener("click",i=>{const c=parseInt(i.currentTarget.getAttribute("data-remove-rule")||"0",10);t.splice(c,1),s()})})}async function o(){const r=document.getElementById("roles-table-body");try{const d=await b.getRoles();if(d.length===0){r.innerHTML='<tr><td colspan="5" class="py-8 text-center text-secondary">No custom roles created yet.</td></tr>';return}r.innerHTML=d.map(i=>`
        <tr class="hover:bg-surfaceHover/50 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary font-mono">${i.name}</td>
          <td class="py-3 px-4 text-secondary">${i.description||"—"}</td>
          <td class="py-3 px-4">
            <div class="flex flex-wrap gap-1 font-mono text-[11px]">
              ${i.permissions.map(c=>`
                <span class="px-1.5 py-0.5 rounded bg-background border border-surfaceBorder text-primary">
                  ${c.database}.${c.table_name}: ${c.operations.join(",")}
                </span>
              `).join("")}
            </div>
          </td>
          <td class="py-3 px-4 text-secondary font-mono">${new Date(i.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-role="${i.name}" class="p-1 text-secondary hover:text-red-400 rounded hover:bg-surfaceHover transition-colors" title="Delete role">
              ${l("trash","w-4 h-4")}
            </button>
          </td>
        </tr>
      `).join(""),r.querySelectorAll("[data-delete-role]").forEach(i=>{i.addEventListener("click",async c=>{const y=c.currentTarget.getAttribute("data-delete-role");if(y&&confirm(`Delete role '${y}'? API keys referencing this role will lose their permission grants.`))try{await b.deleteRole(y),o()}catch(x){alert(x instanceof Error?x.message:"Failed to delete")}})})}catch{r.innerHTML='<tr><td colspan="5" class="py-8 text-center text-red-400">Failed to load roles.</td></tr>'}}document.getElementById("open-create-role-modal")?.addEventListener("click",()=>{t=[],s(),a.classList.add("hidden"),e.classList.remove("hidden")});const n=()=>e.classList.add("hidden");document.getElementById("close-create-role-modal")?.addEventListener("click",n),document.getElementById("cancel-create-role")?.addEventListener("click",n),document.getElementById("add-perm-rule-btn")?.addEventListener("click",()=>{const r=document.getElementById("perm-db-input").value.trim()||"*",d=document.getElementById("perm-table-input").value.trim()||"*",i=[];if(document.getElementById("op-select").checked&&i.push("SELECT"),document.getElementById("op-insert").checked&&i.push("INSERT"),document.getElementById("op-update").checked&&i.push("UPDATE"),document.getElementById("op-delete").checked&&i.push("DELETE"),i.length===0){alert("Select at least one operation (SELECT, INSERT, UPDATE, or DELETE)");return}t.push({database:r,table_name:d,operations:i}),s()}),document.getElementById("create-role-form")?.addEventListener("submit",async r=>{r.preventDefault(),a.classList.add("hidden");const d=document.getElementById("role-name-input").value.trim(),i=document.getElementById("role-desc-input").value.trim()||void 0;if(t.length===0){a.textContent='Add at least one permission rule using the "+ Add Rule to Role" button above.',a.classList.remove("hidden");return}const c=document.getElementById("submit-create-role");c.disabled=!0,c.textContent="Saving...";try{await b.createRole({name:d,description:i,permissions:t}),n(),o()}catch(y){a.textContent=y instanceof Error?y.message:"Failed to save role",a.classList.remove("hidden")}finally{c.disabled=!1,c.textContent="Save Role"}}),o()}async function T(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Cache Engine</h1>
          <p class="text-xs text-secondary mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) caching telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="refresh-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${l("refresh","w-3.5 h-3.5")}
            <span>Refresh</span>
          </button>
          <button id="flush-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-danger/20 hover:bg-accent-danger/30 text-red-400 border border-accent-danger/30 rounded-md text-xs font-medium transition-colors">
            ${l("trash","w-3.5 h-3.5")}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Cache Metrics Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">Overall Hit Ratio</div>
          <div id="cache-hit-rate" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">L1 & L2 combined hits</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">L1 Active Entries</div>
          <div id="cache-entries" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live entries in RAM</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">LRU Evictions</div>
          <div id="cache-evictions" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Capacity threshold evictions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg">
          <div class="text-xs text-secondary mb-1">Cache Misses</div>
          <div id="cache-misses" class="text-2xl font-semibold text-secondary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Queries passed to upstream DB</div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4">
          <div class="flex items-center space-x-2">
            ${l("hard-drive","w-4 h-4 text-accent-blue")}
            <h2 class="text-sm font-semibold text-primary">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-3 text-xs font-mono">
            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-secondary">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-secondary">Survives server restart and power loss</div>
              </div>
              <div id="l2-hits" class="text-accent-blue font-semibold">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-3 text-xs text-secondary leading-relaxed">
          <h2 class="text-sm font-semibold text-primary">Engine Durability Invariants</h2>
          <p>
            The v4 CacheEngine unifies rate limit buckets, query responses, and idempotency tokens.
          </p>
          <ul class="list-disc pl-5 space-y-1">
            <li><strong>L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong>TTL Sweep:</strong> Background BinaryHeap min-heap eviction thread executing on 60s intervals.</li>
            <li><strong>Cache Stampede Guard:</strong> Deduplicates concurrent queries for the same key.</li>
          </ul>
        </div>
      </div>
    </div>
  `;async function t(){try{const e=await b.getCacheStats(),a=e.hits_l1+e.hits_l2,s=a+e.misses,o=s>0?(a/s*100).toFixed(1):"0.0";document.getElementById("cache-hit-rate").textContent=`${o}%`,document.getElementById("cache-entries").textContent=String(e.entries_count),document.getElementById("cache-evictions").textContent=String(e.evictions),document.getElementById("cache-misses").textContent=String(e.misses),document.getElementById("l1-hits").textContent=`${e.hits_l1} hits`,document.getElementById("l2-hits").textContent=`${e.hits_l2} hits`}catch{}}document.getElementById("refresh-cache-btn")?.addEventListener("click",t),document.getElementById("flush-cache-btn")?.addEventListener("click",async()=>{if(confirm("Flush all L1 RAM and L2 persistent cache entries immediately?"))try{await b.flushCache(),alert("Cache flushed successfully"),t()}catch(e){alert(e instanceof Error?e.message:"Flush failed")}}),t()}async function H(u){let t=!0,e=null,a="ALL",s="",o=[];u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Structured Logs</h1>
          <p class="text-xs text-secondary mt-0.5">Live-tail execution events, control plane mutations, and security telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <!-- Level Filter -->
          <select id="log-level-filter" class="px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing">
            <option value="ALL">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          <!-- Search Input -->
          <input 
            id="log-search-input" 
            type="text" 
            placeholder="Search log messages..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-48 sm:w-64"
          />

          <!-- Pause / Resume Button -->
          <button id="toggle-tail-btn" class="px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs font-medium text-primary transition-colors flex items-center space-x-1.5">
            <span id="tail-status-indicator" class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span id="tail-btn-text">Live Tail</span>
          </button>

          <!-- Clear Console -->
          <button id="clear-logs-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Clear console">
            ${l("trash","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Log Terminal Display -->
      <div class="bg-[#121212] border border-surfaceBorder rounded-lg overflow-hidden shadow-inner flex flex-col font-mono text-xs">
        <div class="bg-surface px-4 py-2 border-b border-surfaceBorder flex items-center justify-between text-[11px] text-secondary">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block"></span>
            <span class="ml-2 font-semibold text-primary">axiom-gateway.log</span>
          </div>
          <span id="log-count-indicator">0 events</span>
        </div>

        <div id="log-console-body" class="p-4 space-y-1.5 overflow-y-auto max-h-[640px] min-h-[380px] divide-y divide-white/5">
          <div class="text-secondary py-8 text-center">Connecting to event stream...</div>
        </div>
      </div>
    </div>
  `;function n(){const x=document.getElementById("log-console-body");if(!x)return;const p=o.filter(v=>{const f=a==="ALL"||v.level===a,w=!s||v.message.toLowerCase().includes(s)||v.target.toLowerCase().includes(s)||v.details&&v.details.toLowerCase().includes(s);return f&&w}),m=document.getElementById("log-count-indicator");if(m&&(m.textContent=`${p.length} events logged`),p.length===0){x.innerHTML='<div class="text-secondary py-8 text-center">No log events matching active filter.</div>';return}x.innerHTML=p.map(v=>{let f="text-emerald-400 bg-emerald-500/10 border-emerald-500/20";return v.level==="WARN"?f="text-amber-400 bg-amber-500/10 border-amber-500/20":v.level==="ERROR"&&(f="text-rose-400 bg-rose-500/10 border-rose-500/20"),`
        <div class="pt-1.5 flex items-start space-x-3 text-[11px] leading-relaxed hover:bg-white/[0.02] px-1 rounded">
          <span class="text-secondary/70 shrink-0 select-none">${new Date(v.timestamp*1e3).toISOString().replace("T"," ").substring(0,19)}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border shrink-0 ${f}">${v.level}</span>
          <span class="text-accent-blue font-semibold shrink-0">[${v.target}]</span>
          <span class="text-primary flex-1 break-all">${v.message}</span>
          ${v.details?`<span class="text-secondary/80 text-[10px] shrink-0 truncate max-w-xs">{${v.details}}</span>`:""}
        </div>
      `}).join(""),t&&(x.scrollTop=x.scrollHeight)}async function r(){try{o=(await b.getAuditLog(100,0)).map(p=>{let m="INFO";return p.action.includes("delete")||p.action.includes("fail")?m="WARN":(p.action.includes("ban")||p.action.includes("error"))&&(m="ERROR"),{id:p.id,timestamp:p.timestamp,level:m,target:p.target,message:`${p.actor} performed ${p.action}`,details:p.details}}),n()}catch{}}document.getElementById("log-level-filter")?.addEventListener("change",x=>{a=x.target.value,n()}),document.getElementById("log-search-input")?.addEventListener("input",x=>{s=x.target.value.trim().toLowerCase(),n()});const d=document.getElementById("toggle-tail-btn"),i=document.getElementById("tail-status-indicator"),c=document.getElementById("tail-btn-text");d?.addEventListener("click",()=>{t=!t,t?(i?.classList.remove("bg-amber-500"),i?.classList.add("bg-emerald-500","animate-pulse"),c&&(c.textContent="Live Tail"),r(),e=setInterval(r,2500)):(i?.classList.remove("bg-emerald-500","animate-pulse"),i?.classList.add("bg-amber-500"),c&&(c.textContent="Paused"),e&&clearInterval(e))}),document.getElementById("clear-logs-btn")?.addEventListener("click",()=>{o=[],n()}),await r(),e=setInterval(r,2500);const y=()=>{e&&clearInterval(e),window.removeEventListener("hashchange",y)};window.addEventListener("hashchange",y)}async function D(u){let t=[],e="",a=0;const s=25;u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Audit Trail</h1>
          <p class="text-xs text-secondary mt-0.5">Immutable record of control plane mutations and security actions.</p>
        </div>
        <div class="flex items-center space-x-2">
          <input 
            id="audit-search" 
            type="text" 
            placeholder="Filter actions or targets..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-56"
          />
          <button id="refresh-audit-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors">
            ${l("refresh","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Audit Table -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">ID</th>
                <th class="py-3 px-4">Timestamp</th>
                <th class="py-3 px-4">Actor</th>
                <th class="py-3 px-4">Action</th>
                <th class="py-3 px-4">Target</th>
                <th class="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading audit events...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div class="p-3 bg-background border-t border-surfaceBorder flex items-center justify-between text-xs text-secondary">
          <span id="page-indicator">Showing 0 events</span>
          <div class="flex space-x-2">
            <button id="prev-page-btn" disabled class="px-2.5 py-1 bg-surface border border-surfaceBorder rounded disabled:opacity-40">Previous</button>
            <button id="next-page-btn" disabled class="px-2.5 py-1 bg-surface border border-surfaceBorder rounded disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;function o(){const r=document.getElementById("audit-table-body"),d=t.filter(m=>!e||m.action.toLowerCase().includes(e)||m.target.toLowerCase().includes(e)||m.actor.toLowerCase().includes(e)),i=a*s,c=d.slice(i,i+s);if(c.length===0){r.innerHTML='<tr><td colspan="6" class="py-8 text-center text-secondary">No matching audit events found.</td></tr>',document.getElementById("page-indicator").textContent=`Showing 0 of ${d.length} events`;return}r.innerHTML=c.map(m=>`
      <tr class="hover:bg-surfaceHover/50 transition-colors">
        <td class="py-2.5 px-4 text-secondary text-[11px]">#${m.id}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px]">${new Date(m.timestamp*1e3).toLocaleString()}</td>
        <td class="py-2.5 px-4 font-semibold text-primary">${m.actor}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-accent-orange/10 text-accent-orange border border-accent-orange/20">
            ${m.action}
          </span>
        </td>
        <td class="py-2.5 px-4 text-primary font-medium">${m.target}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px] truncate max-w-xs">${m.details||"—"}</td>
      </tr>
    `).join("");const y=Math.ceil(d.length/s);document.getElementById("page-indicator").textContent=`Page ${a+1} of ${y||1} (${d.length} total events)`;const x=document.getElementById("prev-page-btn"),p=document.getElementById("next-page-btn");x.disabled=a===0,p.disabled=i+s>=d.length}async function n(){try{t=await b.getAuditLog(500,0),o()}catch{const r=document.getElementById("audit-table-body");r.innerHTML='<tr><td colspan="6" class="py-8 text-center text-red-400">Failed to load audit records.</td></tr>'}}document.getElementById("audit-search")?.addEventListener("input",r=>{e=r.target.value.trim().toLowerCase(),a=0,o()}),document.getElementById("prev-page-btn")?.addEventListener("click",()=>{a>0&&(a--,o())}),document.getElementById("next-page-btn")?.addEventListener("click",()=>{a++,o()}),document.getElementById("refresh-audit-btn")?.addEventListener("click",n),n()}async function P(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Prometheus Metrics</h1>
          <p class="text-xs text-secondary mt-0.5">Exposition format scraped at <code class="text-accent-orange font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="copy-raw-metrics" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${l("copy","w-3.5 h-3.5")}
            <span>Copy Exposition</span>
          </button>
          <button id="refresh-metrics-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors">
            ${l("refresh","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Raw Exposition Block -->
      <div class="bg-surface border border-surfaceBorder rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-primary">Live Scraping Endpoint Feed</span>
          <span class="text-[11px] text-secondary font-mono">text/plain; version=0.0.4</span>
        </div>
        <div class="bg-background border border-surfaceBorder rounded-md p-4 overflow-x-auto max-h-[600px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-xs text-secondary leading-relaxed whitespace-pre">Loading metrics...</pre>
        </div>
      </div>
    </div>
  `;async function t(){try{const e=await b.getRawMetrics(),a=document.getElementById("raw-metrics-display");a.textContent=e}catch{const e=document.getElementById("raw-metrics-display");e.textContent="Failed to load /metrics endpoint."}}document.getElementById("refresh-metrics-btn")?.addEventListener("click",t),document.getElementById("copy-raw-metrics")?.addEventListener("click",()=>{const e=document.getElementById("raw-metrics-display").textContent||"";navigator.clipboard.writeText(e),alert("Prometheus exposition copied to clipboard!")}),t()}async function j(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 class="text-xl font-semibold text-primary">System Information</h1>
        <p class="text-xs text-secondary mt-0.5">Runtime architecture and process diagnostics.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${l("server","w-4 h-4 text-accent-orange")}
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Binary Version</span>
              <span class="text-primary font-bold">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Async Runtime</span>
              <span class="text-primary">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Memory Allocator</span>
              <span class="text-primary">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Metadata Engine</span>
              <span class="text-primary">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary">Protocol Handlers</span>
              <span class="text-primary">HTTP/1.1 JSON + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${l("activity","w-4 h-4 text-emerald-400")}
            <span>Live Process Diagnostics</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Process Uptime</span>
              <span id="sys-uptime" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Process CPU Load</span>
              <span id="sys-cpu" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary">Active DB Pools</span>
              <span id="sys-pools" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary">Active Client Keys</span>
              <span id="sys-keys" class="text-primary font-semibold">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;async function t(){try{const e=await b.getStatus(),a=Math.floor(e.uptime_seconds/60),s=a<60?`${a} minutes`:`${Math.floor(a/60)} hours, ${a%60} minutes`;document.getElementById("sys-uptime").textContent=s,document.getElementById("sys-mem").textContent=`${e.memory_mb} MB`,document.getElementById("sys-cpu").textContent=`${e.cpu_percent.toFixed(1)}%`,document.getElementById("sys-pools").textContent=`${e.active_databases} connected`,document.getElementById("sys-keys").textContent=`${e.registered_keys} keys registered`}catch{}}t()}const h=document.getElementById("app");let g=!1;async function k(){const u=window.location.hash||"#/overview";try{if((await b.checkSetupStatus()).setup_required){if(u!=="#/setup"){window.location.hash="#/setup";return}$(h);return}else if(u==="#/setup"){window.location.hash="#/login";return}}catch{}if(u==="#/login"){C(h);return}if(!localStorage.getItem("axiom_session_token")){window.location.hash="#/login";return}const e=u.replace("#/","").split("?")[0]||"overview";h.innerHTML=`
    <div class="min-h-screen bg-background flex flex-col">
      <div id="navbar-container"></div>
      <div class="flex-1 flex overflow-hidden">
        <div id="sidebar-container"></div>
        <main id="main-content" class="flex-1 overflow-y-auto bg-background"></main>
      </div>
    </div>
  `;const a=()=>{g=!g,o()},s=()=>{g=!1,o()},o=()=>{const d=document.getElementById("sidebar-container");d&&(d.innerHTML=S(e,g,s),document.getElementById("sidebar-close-btn")?.addEventListener("click",s))},n=document.getElementById("navbar-container");n.innerHTML=L(a),o();const r=document.getElementById("main-content");switch(e){case"overview":B(r);break;case"databases":R(r);break;case"keys":M(r);break;case"roles":A(r);break;case"cache":T(r);break;case"logs":H(r);break;case"audit":D(r);break;case"metrics":P(r);break;case"system":j(r);break;default:B(r);break}}window.addEventListener("hashchange",()=>{g=!1,k()});k();
