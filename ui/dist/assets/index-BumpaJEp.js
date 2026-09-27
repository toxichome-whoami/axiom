var T=Object.defineProperty;var M=(u,t,e)=>t in u?T(u,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):u[t]=e;var $=(u,t,e)=>M(u,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const r of s)if(r.type==="childList")for(const n of r.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&a(n)}).observe(document,{childList:!0,subtree:!0});function e(s){const r={};return s.integrity&&(r.integrity=s.integrity),s.referrerPolicy&&(r.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?r.credentials="include":s.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function a(s){if(s.ep)return;s.ep=!0;const r=e(s);fetch(s.href,r)}})();class A{getHeaders(){const t={"Content-Type":"application/json",Accept:"application/json"},e=localStorage.getItem("axiom_session_token");return e&&(t.Authorization=`Bearer ${e}`),t}async request(t,e={}){const a=t.startsWith("/")?t:`/${t}`,s=await fetch(a,{...e,headers:{...this.getHeaders(),...e.headers||{}}});if(s.status===401&&!window.location.hash.includes("#/login")&&!window.location.hash.includes("#/setup")&&(localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username"),window.location.hash="#/login"),(s.headers.get("content-type")||"").includes("text/plain")){const o=await s.text();if(!s.ok)throw new Error(o||`HTTP ${s.status}`);return o}const n=await s.json();if(!n.success&&n.error)throw new Error(n.error.message||n.error.code||"API error");return n.data}async checkSetupStatus(){return this.request("/admin/v1/setup/begin",{method:"POST"})}async createAdminAccount(t){return this.request("/admin/v1/setup/account",{method:"POST",body:JSON.stringify(t)})}async setupDatabase(t){return this.request("/admin/v1/setup/database",{method:"POST",body:JSON.stringify(t)})}async completeSetup(){return this.request("/admin/v1/setup/complete",{method:"POST"})}async login(t){return this.request("/admin/v1/auth/login",{method:"POST",body:JSON.stringify(t)})}async logout(){try{await this.request("/admin/v1/auth/logout",{method:"POST"})}finally{localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username")}}async getStatus(){return this.request("/admin/v1/status")}async getDatabases(){return this.request("/admin/v1/databases")}async addDatabase(t){return this.request("/admin/v1/databases",{method:"POST",body:JSON.stringify(t)})}async deleteDatabase(t){return this.request(`/admin/v1/databases/${encodeURIComponent(t)}`,{method:"DELETE"})}async getKeys(){return this.request("/admin/v1/keys")}async createKey(t){return this.request("/admin/v1/keys",{method:"POST",body:JSON.stringify(t)})}async deleteKey(t){return this.request(`/admin/v1/keys/${encodeURIComponent(t)}`,{method:"DELETE"})}async getRoles(){return this.request("/admin/v1/roles")}async createRole(t){return this.request("/admin/v1/roles",{method:"POST",body:JSON.stringify(t)})}async updateRole(t,e){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"PATCH",body:JSON.stringify(e)})}async deleteRole(t){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"DELETE"})}async getCacheStats(){return this.request("/admin/v1/cache/stats")}async flushCache(){return this.request("/admin/v1/cache/flush",{method:"POST"})}async getAuditLog(t=100,e=0){return this.request(`/admin/v1/audit?limit=${t}&offset=${e}`)}async testDatabase(t){return this.request(`/admin/v1/databases/${encodeURIComponent(t)}/test`)}async rotateKey(t){return this.request(`/admin/v1/keys/${encodeURIComponent(t)}/rotate`,{method:"POST"})}async reloadMetadata(){return this.request("/admin/v1/reload",{method:"POST"})}async getHealth(){return this.request("/health")}async getRawMetrics(){return this.request("/metrics")}}const v=new A;function m(u,t="w-4 h-4"){const e=`class="${t} inline-block" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"`;switch(u){case"dashboard":return`<svg ${e}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;case"database":return`<svg ${e}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;case"key":return`<svg ${e}><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`;case"shield":return`<svg ${e}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`;case"hard-drive":return`<svg ${e}><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>`;case"file-text":return`<svg ${e}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;case"activity":return`<svg ${e}><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2"/></svg>`;case"server":return`<svg ${e}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;case"plus":return`<svg ${e}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;case"trash":return`<svg ${e}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;case"refresh":return`<svg ${e}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`;case"copy":return`<svg ${e}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;case"check":return`<svg ${e}><path d="M20 6 9 17l-5-5"/></svg>`;case"logout":return`<svg ${e}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;case"menu":return`<svg ${e}><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;case"x":return`<svg ${e}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;default:return`<svg ${e}><circle cx="12" cy="12" r="10"/></svg>`}}class D{constructor(){$(this,"container",null)}ensureContainer(){return(!this.container||!document.body.contains(this.container))&&(this.container=document.createElement("div"),this.container.id="axiom-toast-container",this.container.className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full px-4",document.body.appendChild(this.container)),this.container}show(t,e="info",a=3500){const s=this.ensureContainer(),r=document.createElement("div");r.className=`
      pointer-events-auto flex items-center space-x-3 px-3.5 py-2.5 rounded-lg border shadow-lg text-xs font-medium
      transition-all duration-200 transform translate-y-2 opacity-0
      ${e==="success"?"bg-[#18181B] border-emerald-500/30 text-emerald-400":e==="error"?"bg-[#18181B] border-rose-500/30 text-rose-400":"bg-[#18181B] border-surfaceBorder text-primary"}
    `;const n=e==="success"?m("check","w-4 h-4 text-emerald-400 shrink-0"):e==="error"?m("x","w-4 h-4 text-rose-400 shrink-0"):m("activity","w-4 h-4 text-accent-blue shrink-0");r.innerHTML=`
      ${n}
      <span class="flex-1 text-primary leading-tight">${t}</span>
      <button class="toast-close text-secondary hover:text-primary p-0.5 ml-2 transition-colors">
        ${m("x","w-3.5 h-3.5")}
      </button>
    `,s.appendChild(r),requestAnimationFrame(()=>{r.classList.remove("translate-y-2","opacity-0"),r.classList.add("translate-y-0","opacity-100")});const o=()=>{r.classList.remove("opacity-100","translate-y-0"),r.classList.add("opacity-0","translate-y-2"),setTimeout(()=>{r.parentElement&&r.parentElement.removeChild(r)},200)},b=setTimeout(o,a);r.querySelector(".toast-close")?.addEventListener("click",()=>{clearTimeout(b),o()})}success(t,e=3e3){this.show(t,"success",e)}error(t,e=4500){this.show(t,"error",e)}info(t,e=3e3){this.show(t,"info",e)}}const y=new D;function B(u){const t=document.getElementById("axiom-confirm-modal");t&&t.remove();const e=document.createElement("div");e.id="axiom-confirm-modal",e.className="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-opacity",e.innerHTML=`
    <div class="bg-surface border border-surfaceBorder rounded-lg max-w-sm w-full p-5 space-y-4 shadow-xl transform transition-transform scale-95 animate-in">
      <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
        ${u.danger?m("trash","w-4 h-4 text-accent-danger"):m("shield","w-4 h-4 text-accent-orange")}
        <span>${u.title}</span>
      </div>
      <p class="text-xs text-secondary leading-relaxed">${u.message}</p>
      <div class="flex justify-end space-x-2 pt-2">
        <button id="axiom-confirm-cancel" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md text-xs font-medium transition-colors">
          ${u.cancelText||"Cancel"}
        </button>
        <button id="axiom-confirm-ok" class="px-3 py-1.5 ${u.danger?"bg-accent-danger hover:bg-red-700":"bg-accent-orange hover:bg-orange-600"} text-white rounded-md text-xs font-medium transition-colors">
          ${u.confirmText||"Confirm"}
        </button>
      </div>
    </div>
  `,document.body.appendChild(e);const a=()=>e.remove(),s=e.querySelector("#axiom-confirm-cancel"),r=e.querySelector("#axiom-confirm-ok");s.focus(),s.addEventListener("click",a),e.addEventListener("click",o=>{o.target===e&&a()});const n=o=>{o.key==="Escape"&&(window.removeEventListener("keydown",n),a())};window.addEventListener("keydown",n),r.addEventListener("click",async()=>{r.disabled=!0,r.textContent="Processing...";try{await u.onConfirm()}finally{window.removeEventListener("keydown",n),a()}})}function H(u){const t=localStorage.getItem("axiom_username")||"admin";return setTimeout(()=>{document.getElementById("mobile-menu-btn")?.addEventListener("click",u),document.getElementById("reload-meta-btn")?.addEventListener("click",async()=>{const r=document.getElementById("reload-meta-btn");r.disabled=!0,r.classList.add("opacity-50");try{await v.reloadMetadata(),y.success("Metadata snapshot reloaded into memory")}catch(n){y.error(n instanceof Error?n.message:"Reload failed")}finally{r.disabled=!1,r.classList.remove("opacity-50")}}),document.getElementById("logout-btn")?.addEventListener("click",async()=>{await v.logout(),y.info("Signed out of administrative session"),window.location.hash="#/login"});const e=async()=>{const r=document.getElementById("navbar-health-pill"),n=document.getElementById("navbar-health-dot"),o=document.getElementById("navbar-health-text");if(!r||!n||!o)return;const b=performance.now();try{const p=await v.getHealth(),x=Math.round(performance.now()-b);p.status==="ok"?(n.className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse",o.textContent=`Online (${x}ms)`):(n.className="w-2 h-2 rounded-full bg-amber-400",o.textContent="Degraded")}catch{n.className="w-2 h-2 rounded-full bg-rose-500",o.textContent="Disconnected"}};e();const a=setInterval(e,15e3),s=()=>{clearInterval(a),window.removeEventListener("hashchange",s)};window.addEventListener("hashchange",s)},0),`
    <header class="h-14 border-b border-surfaceBorder bg-surface px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      <div class="flex items-center space-x-3">
        <button 
          id="mobile-menu-btn" 
          aria-label="Open Navigation Menu"
          class="lg:hidden p-2 text-secondary hover:text-primary hover:bg-surfaceHover rounded-md transition-colors"
        >
          ${m("menu","w-5 h-5")}
        </button>

        <a href="#/overview" class="flex items-center space-x-2.5 group">
          <div class="w-6 h-6 rounded bg-accent-orange text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs transition-transform group-hover:scale-105">
            AX
          </div>
          <span class="font-semibold text-sm text-primary tracking-tight">Axiom</span>
          <span class="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-surfaceHover text-secondary border border-surfaceBorder">v4.0</span>
        </a>
      </div>

      <div class="flex items-center space-x-3 sm:space-x-4">
        <!-- Live Gateway Status Indicator -->
        <div id="navbar-health-pill" class="hidden sm:flex items-center space-x-1.5 text-xs text-secondary bg-background px-2.5 py-1 rounded-full border border-surfaceBorder">
          <span id="navbar-health-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="navbar-health-text">Online</span>
        </div>

        <!-- Reload Config Button -->
        <button 
          id="reload-meta-btn"
          title="Hot-reload metadata and snapshot from axiom.db"
          class="flex items-center space-x-1.5 px-2.5 py-1 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md text-xs transition-colors border border-surfaceBorder"
        >
          ${m("refresh","w-3 h-3")}
          <span class="hidden md:inline">Reload Snapshot</span>
        </button>

        <!-- User profile & Logout -->
        <div class="flex items-center space-x-2 pl-2 border-l border-surfaceBorder text-xs">
          <div class="w-6 h-6 rounded-full bg-accent-orange/20 text-accent-orange flex items-center justify-center font-bold text-[11px] uppercase">
            ${t.charAt(0)}
          </div>
          <span class="text-secondary font-mono hidden sm:inline">${t}</span>
          <button 
            id="logout-btn" 
            title="Sign out of console"
            class="p-1.5 text-secondary hover:text-red-400 hover:bg-surfaceHover rounded-md transition-colors"
          >
            ${m("logout","w-4 h-4")}
          </button>
        </div>
      </div>
    </header>
  `}const P=[{id:"overview",label:"Overview",iconName:"dashboard",hash:"#/overview"},{id:"databases",label:"Databases",iconName:"database",hash:"#/databases"},{id:"keys",label:"API Keys",iconName:"key",hash:"#/keys"},{id:"roles",label:"Roles & RBAC",iconName:"shield",hash:"#/roles"},{id:"cache",label:"Cache Engine",iconName:"hard-drive",hash:"#/cache"},{id:"logs",label:"Live Logs",iconName:"file-text",hash:"#/logs"},{id:"audit",label:"Audit Trail",iconName:"file-text",hash:"#/audit"},{id:"metrics",label:"Metrics",iconName:"activity",hash:"#/metrics"},{id:"system",label:"System",iconName:"server",hash:"#/system"}];function S(u,t,e){setTimeout(()=>{document.getElementById("sidebar-backdrop")?.addEventListener("click",e)},0);const a=P.map(s=>{const r=u===s.id,n=r?"bg-surfaceBorder text-primary font-medium border-l-2 border-accent-orange":"text-secondary hover:text-primary hover:bg-surfaceHover border-l-2 border-transparent";return`
      <a 
        href="${s.hash}" 
        class="flex items-center space-x-3 px-3 py-2.5 sm:py-2 rounded-r-md text-xs transition-colors duration-150 touch-manipulation min-h-[40px] sm:min-h-[36px] ${n}"
      >
        <span class="${r?"text-accent-orange":"text-secondary"} shrink-0">
          ${m(s.iconName,"w-4 h-4")}
        </span>
        <span class="truncate">${s.label}</span>
      </a>
    `}).join("");return`
    <!-- Mobile Backdrop Drawer Overlay -->
    <div 
      id="sidebar-backdrop" 
      class="fixed inset-0 bg-black/60 z-30 transition-opacity lg:hidden ${t?"block":"hidden"}"
    ></div>

    <!-- Sidebar Container -->
    <aside 
      class="fixed inset-y-0 left-0 z-40 w-60 bg-surface border-r border-surfaceBorder transform transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 flex flex-col ${t?"translate-x-0":"-translate-x-full"}"
    >
      <div class="h-14 border-b border-surfaceBorder px-4 flex items-center justify-between lg:hidden shrink-0">
        <span class="text-xs font-semibold text-primary">Menu</span>
        <button id="sidebar-close-btn" class="p-2 text-secondary hover:text-primary touch-manipulation">
          ${m("x","w-5 h-5")}
        </button>
      </div>

      <div class="p-3 space-y-1 flex-1 overflow-y-auto">
        <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary/60">
          Control Plane
        </div>
        ${a}
      </div>

      <div class="p-3 border-t border-surfaceBorder bg-surface shrink-0">
        <div class="flex items-center justify-between px-2 text-[11px] text-secondary font-mono">
          <span>Engine v4.0.0</span>
          <a href="#/system" class="text-accent-orange hover:underline text-[10px]">Diagnostics</a>
        </div>
      </div>
    </aside>
  `}function j(u){let t=1,e="",a="",s="",r="",n="postgres",o="";function b(){u.innerHTML=`
      <div class="min-h-screen flex items-center justify-center p-4 bg-background">
        <div class="w-full max-w-lg bg-surface border border-surfaceBorder rounded-lg p-6 sm:p-8 shadow-xl">
          
          <!-- Stepper Indicator -->
          <div class="flex items-center justify-between mb-8 border-b border-surfaceBorder pb-4">
            <div class="flex items-center space-x-2.5">
              <div class="w-7 h-7 rounded-md bg-accent-orange text-white flex items-center justify-center font-bold text-xs shadow-xs">
                AX
              </div>
              <span class="text-sm font-semibold text-primary">Axiom Setup Wizard</span>
            </div>
            <div class="text-xs text-secondary font-mono">
              Step ${t} of 4
            </div>
          </div>

          <div id="setup-error" class="hidden mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

          ${p()}

        </div>
      </div>
    `,x()}function p(){switch(t){case 1:return`
          <div class="space-y-4">
            <h2 class="text-lg font-semibold text-primary">Welcome to Axiom Gateway</h2>
            <p class="text-xs text-secondary leading-relaxed">
              Axiom is a high-performance SQL API gateway that unifies database pooling, 
              RBAC authorization, high-speed L1/L2 caching, and Model Context Protocol (MCP) into a single binary.
            </p>
            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs text-secondary">
              <div class="flex items-center space-x-2 text-primary font-medium">
                ${m("shield","w-4 h-4 text-accent-orange")}
                <span>What we will configure:</span>
              </div>
              <ul class="list-disc pl-5 space-y-1.5 text-secondary pt-1">
                <li>Create the primary administrative owner account.</li>
                <li>Connect your first upstream SQL database (PostgreSQL, MySQL, SQLite, MSSQL, ClickHouse).</li>
                <li>Bootstrap the persistent cryptographic metadata store (<code class="text-primary font-mono">axiom.db</code>).</li>
              </ul>
            </div>
            <button id="step1-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors shadow-xs">
              Begin Configuration &rarr;
            </button>
          </div>
        `;case 2:return`
          <form id="step2-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Create Primary Administrator</h2>
              <p class="text-xs text-secondary mt-0.5">This account owns and manages the Web UI console and operator policies.</p>
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

            <button type="submit" id="step2-next" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors shadow-xs">
              Continue to Database Setup &rarr;
            </button>
          </form>
        `;case 3:return`
          <form id="step3-form" class="space-y-4">
            <div>
              <h2 class="text-lg font-semibold text-primary">Connect First Database</h2>
              <p class="text-xs text-secondary mt-0.5">Register an upstream SQL database pool. You can also skip this and add databases later.</p>
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
                value="${r}"
                class="w-full px-3 py-2 text-sm bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none focus:ring-1 focus:ring-focusRing font-mono text-xs"
              />
            </div>

            <div class="flex space-x-3 pt-2">
              <button type="button" id="step3-skip" class="flex-1 py-2.5 px-4 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary text-sm font-medium rounded-md transition-colors">
                Skip for Now
              </button>
              <button type="submit" id="step3-next" class="flex-1 py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors shadow-xs">
                Save & Continue
              </button>
            </div>
          </form>
        `;case 4:return`
          <div class="space-y-4">
            <div class="text-center py-4">
              <div class="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center mb-3">
                ${m("check","w-6 h-6")}
              </div>
              <h2 class="text-xl font-semibold text-primary">Setup Complete!</h2>
              <p class="text-xs text-secondary mt-1">Axiom Gateway is initialized and the wizard is now permanently locked.</p>
            </div>

            <div class="bg-background border border-surfaceBorder rounded-md p-4 space-y-2 text-xs">
              <div class="text-secondary font-medium">Session Token:</div>
              <div class="flex items-center justify-between bg-surface p-2.5 rounded border border-surfaceBorder font-mono text-[11px] text-primary overflow-x-auto">
                <span class="truncate">${o||"Active Session Established"}</span>
              </div>
            </div>

            <button id="step4-finish" class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 text-white text-sm font-medium rounded-md transition-colors shadow-xs">
              Launch Gateway Dashboard &rarr;
            </button>
          </div>
        `;default:return""}}function x(){const c=document.getElementById("setup-error");t===1?document.getElementById("step1-next")?.addEventListener("click",()=>{t=2,b()}):t===2?(document.getElementById("admin-user")?.focus(),document.getElementById("step2-form")?.addEventListener("submit",async d=>{d.preventDefault(),e=document.getElementById("admin-user").value.trim(),a=document.getElementById("admin-pass").value;const l=document.getElementById("step2-next");l.disabled=!0,l.textContent="Creating Account...";try{const i=await v.createAdminAccount({username:e,password:a});o=i.token,localStorage.setItem("axiom_session_token",i.token),localStorage.setItem("axiom_username",i.username),y.success("Admin account created"),t=3,b()}catch(i){c.textContent=i instanceof Error?i.message:"Account creation failed",c.classList.remove("hidden"),l.disabled=!1,l.textContent="Continue to Database Setup"}})):t===3?(document.getElementById("db-alias")?.focus(),document.getElementById("step3-skip")?.addEventListener("click",async()=>{try{await v.completeSetup(),y.info("Database setup skipped"),t=4,b()}catch{t=4,b()}}),document.getElementById("step3-form")?.addEventListener("submit",async d=>{if(d.preventDefault(),s=document.getElementById("db-alias").value.trim(),n=document.getElementById("db-engine").value,r=document.getElementById("db-url").value.trim(),s&&r)try{await v.setupDatabase({alias:s,url:r,engine:n}),y.success(`Connected database '${s}'`)}catch(l){c.textContent=l instanceof Error?l.message:"Failed to register database",c.classList.remove("hidden");return}try{await v.completeSetup()}catch{}t=4,b()})):t===4&&document.getElementById("step4-finish")?.addEventListener("click",()=>{window.location.hash="#/overview"})}b()}function q(u){u.innerHTML=`
    <div class="min-h-screen flex items-center justify-center p-4 bg-background">
      <div class="w-full max-w-sm bg-surface border border-surfaceBorder rounded-lg p-6 sm:p-8 shadow-xl">
        <div class="flex items-center space-x-3 mb-6">
          <div class="w-8 h-8 rounded-md bg-accent-orange flex items-center justify-center font-bold text-white tracking-wider shadow-xs">
            AX
          </div>
          <div>
            <h1 class="text-base font-semibold text-primary">Axiom Gateway</h1>
            <p class="text-xs text-secondary">Administrative Console</p>
          </div>
        </div>

        <div id="login-error" class="hidden mb-4 p-3 rounded-md bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

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
            class="w-full py-2.5 px-4 bg-accent-orange hover:bg-orange-600 active:bg-orange-700 text-white text-sm font-medium rounded-md transition-colors duration-150 flex items-center justify-center shadow-xs"
          >
            <span>Sign In</span>
          </button>
        </form>
      </div>
    </div>
  `;const t=document.getElementById("login-form"),e=document.getElementById("login-error"),a=document.getElementById("login-btn");document.getElementById("username")?.focus(),t.addEventListener("submit",async s=>{s.preventDefault(),e.classList.add("hidden"),e.textContent="",a.disabled=!0,a.innerHTML="<span>Verifying credentials...</span>";const r=document.getElementById("username").value.trim(),n=document.getElementById("password").value;try{const o=await v.login({username:r,password:n});localStorage.setItem("axiom_session_token",o.token),localStorage.setItem("axiom_username",o.username),y.success(`Welcome back, ${o.username}`),window.location.hash="#/overview"}catch(o){e.textContent=o instanceof Error?o.message:"Invalid credentials",e.classList.remove("hidden")}finally{a.disabled=!1,a.innerHTML="<span>Sign In</span>"}})}async function C(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Overview</h1>
          <p class="text-xs text-secondary mt-0.5">Real-time gateway status, cluster topology, and cache telemetry.</p>
        </div>
        <button id="refresh-overview" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
          ${m("refresh","w-3.5 h-3.5")}
          <span>Refresh</span>
        </button>
      </div>

      <!-- Stat Cards Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <a href="#/databases" class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs hover:border-borderDefault transition-colors group">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium group-hover:text-primary transition-colors">Databases</span>
            ${m("database","w-4 h-4 text-accent-blue")}
          </div>
          <div id="stat-dbs" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Configured connection pools</div>
        </a>

        <a href="#/keys" class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs hover:border-borderDefault transition-colors group">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium group-hover:text-primary transition-colors">API Keys</span>
            ${m("key","w-4 h-4 text-accent-orange")}
          </div>
          <div id="stat-keys" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Active client credentials</div>
        </a>

        <a href="#/cache" class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs hover:border-borderDefault transition-colors group">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium group-hover:text-primary transition-colors">Cache Hit Rate</span>
            ${m("hard-drive","w-4 h-4 text-emerald-400")}
          </div>
          <div id="stat-cache-rate" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div id="stat-cache-entries" class="text-[11px] text-secondary mt-1">0 active entries</div>
        </a>

        <a href="#/system" class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs hover:border-borderDefault transition-colors group">
          <div class="flex items-center justify-between text-secondary mb-1">
            <span class="text-xs font-medium group-hover:text-primary transition-colors">System Uptime</span>
            ${m("activity","w-4 h-4 text-purple-400")}
          </div>
          <div id="stat-uptime" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div id="stat-mem" class="text-[11px] text-secondary mt-1">Memory RSS: — MB</div>
        </a>
      </div>

      <!-- Quick Actions & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Quick Actions -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <h2 class="text-sm font-semibold text-primary">Quick Actions</h2>
          <div class="space-y-2">
            <a href="#/databases" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-blue/10 text-accent-blue">${m("database","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange transition-colors">Connect Database</div>
                  <div class="text-[11px] text-secondary">Add PostgreSQL, MySQL, SQLite, MSSQL</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary transition-colors">&rarr;</span>
            </a>

            <a href="#/keys" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-accent-orange/10 text-accent-orange">${m("key","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange transition-colors">Create API Key</div>
                  <div class="text-[11px] text-secondary">Issue client credentials with role limits</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary transition-colors">&rarr;</span>
            </a>

            <a href="#/cache" class="flex items-center justify-between p-3 rounded-md bg-background border border-surfaceBorder hover:border-borderDefault transition-colors group">
              <div class="flex items-center space-x-3">
                <span class="p-2 rounded bg-emerald-500/10 text-emerald-400">${m("hard-drive","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-primary group-hover:text-accent-orange transition-colors">Inspect Cache</div>
                  <div class="text-[11px] text-secondary">L1 RAM & L2 disk persistence metrics</div>
                </div>
              </div>
              <span class="text-secondary group-hover:text-primary transition-colors">&rarr;</span>
            </a>
          </div>
        </div>

        <!-- Recent Audit Log Activity -->
        <div class="lg:col-span-2 bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold text-primary">Recent Control Plane Activity</h2>
            <a href="#/audit" class="text-xs text-accent-orange hover:underline font-medium">View full trail &rarr;</a>
          </div>

          <div id="overview-audit-list" class="space-y-2">
            <div class="text-xs text-secondary py-8 text-center font-sans">Loading audit events...</div>
          </div>
        </div>
      </div>
    </div>
  `;async function t(){try{const[e,a,s]=await Promise.all([v.getStatus().catch(()=>null),v.getCacheStats().catch(()=>null),v.getAuditLog(6,0).catch(()=>[])]);if(e){document.getElementById("stat-dbs").textContent=String(e.active_databases),document.getElementById("stat-keys").textContent=String(e.registered_keys);const n=Math.floor(e.uptime_seconds/60),o=n<60?`${n}m`:`${Math.floor(n/60)}h ${n%60}m`;document.getElementById("stat-uptime").textContent=o,document.getElementById("stat-mem").textContent=`Memory RSS: ${e.memory_mb} MB | CPU: ${e.cpu_percent.toFixed(1)}%`}if(a){const n=a.hits_l1+a.hits_l2,o=n+a.misses,b=o>0?(n/o*100).toFixed(1):"0.0";document.getElementById("stat-cache-rate").textContent=`${b}%`,document.getElementById("stat-cache-entries").textContent=`${a.entries_count} L1 cached entries`}const r=document.getElementById("overview-audit-list");s&&s.length>0?r.innerHTML=s.map(n=>`
          <div class="flex items-center justify-between py-2.5 px-3 rounded bg-background border border-surfaceBorder text-xs hover:border-borderDefault transition-colors">
            <div class="flex items-center space-x-2.5">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold uppercase bg-accent-orange/10 text-accent-orange border border-accent-orange/20">
                ${n.action}
              </span>
              <span class="text-primary font-medium">${n.target}</span>
              ${n.details?`<span class="text-secondary text-[11px] truncate max-w-xs hidden sm:inline">(${n.details})</span>`:""}
            </div>
            <div class="text-secondary text-[11px] font-mono shrink-0">
              ${new Date(n.timestamp*1e3).toLocaleTimeString()}
            </div>
          </div>
        `).join(""):r.innerHTML='<div class="text-xs text-secondary py-8 text-center font-sans">No recent audit log entries recorded.</div>'}catch{}}document.getElementById("refresh-overview")?.addEventListener("click",async()=>{await t(),y.info("Overview telemetry refreshed")}),t()}async function _(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Databases</h1>
          <p class="text-xs text-secondary mt-0.5">Manage live connection pools, upstream dialects, and health probes.</p>
        </div>
        <button id="open-add-db-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors shadow-xs">
          ${m("plus","w-3.5 h-3.5")}
          <span>Connect Database</span>
        </button>
      </div>

      <!-- Databases Table Card -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Alias</th>
                <th class="py-3 px-4">Engine Dialect</th>
                <th class="py-3 px-4">Pool Bounds</th>
                <th class="py-3 px-4">Registered</th>
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
    <div id="add-db-modal" class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Connect Upstream Database</h2>
          <button id="close-add-db-modal" class="text-secondary hover:text-primary p-1">
            ${m("x","w-4 h-4")}
          </button>
        </div>

        <div id="modal-error" class="hidden p-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="add-db-form" class="space-y-3.5 text-xs">
          <div>
            <label for="new-db-alias" class="block text-secondary mb-1">Database Alias</label>
            <input 
              id="new-db-alias" 
              type="text" 
              required 
              placeholder="e.g. analytics_db" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="new-db-engine" class="block text-secondary mb-1">Engine Dialect</label>
            <select 
              id="new-db-engine" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite / LibSQL</option>
              <option value="mssql">Microsoft SQL Server</option>
              <option value="clickhouse">ClickHouse</option>
            </select>
          </div>

          <div>
            <label for="new-db-url" class="block text-secondary mb-1">Connection URL</label>
            <input 
              id="new-db-url" 
              type="text" 
              required 
              placeholder="postgres://user:pass@localhost:5432/dbname" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono text-xs focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="new-db-min" class="block text-secondary mb-1">Min Pool</label>
              <input 
                id="new-db-min" 
                type="number" 
                value="1" 
                min="1" 
                class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
              />
            </div>
            <div>
              <label for="new-db-max" class="block text-secondary mb-1">Max Pool</label>
              <input 
                id="new-db-max" 
                type="number" 
                value="10" 
                min="1" 
                class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
              />
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-3 border-t border-surfaceBorder">
            <button type="button" id="cancel-add-db" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md transition-colors">
              Cancel
            </button>
            <button type="submit" id="submit-add-db" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md transition-colors">
              Connect Pool
            </button>
          </div>
        </form>
      </div>
    </div>
  `;const t=document.getElementById("add-db-modal"),e=document.getElementById("modal-error");async function a(){const o=document.getElementById("db-table-body");try{const b=await v.getDatabases();if(b.length===0){o.innerHTML=`
          <tr>
            <td colspan="5" class="py-12 text-center text-secondary">
              No databases connected yet. Click "Connect Database" to register your first pool.
            </td>
          </tr>
        `;return}o.innerHTML=b.map(p=>`
        <tr class="hover:bg-surfaceHover/40 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary font-mono">${p.alias}</td>
          <td class="py-3 px-4">
            <span class="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-accent-blue/10 text-accent-blue border border-accent-blue/20">
              ${p.engine}
            </span>
          </td>
          <td class="py-3 px-4 text-secondary">${p.pool_min} – ${p.pool_max} conns</td>
          <td class="py-3 px-4 text-secondary">${new Date(p.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <div class="inline-flex items-center space-x-1">
              <button 
                data-test-alias="${p.alias}" 
                class="px-2 py-1 text-secondary hover:text-emerald-400 rounded hover:bg-surfaceHover transition-colors flex items-center space-x-1" 
                title="Test live database connectivity"
              >
                ${m("activity","w-3.5 h-3.5")}
                <span class="text-[11px] font-sans">Test</span>
              </button>
              <button 
                data-delete-alias="${p.alias}" 
                class="p-1 text-secondary hover:text-rose-400 rounded hover:bg-surfaceHover transition-colors" 
                title="Disconnect database pool"
              >
                ${m("trash","w-4 h-4")}
              </button>
            </div>
          </td>
        </tr>
      `).join(""),o.querySelectorAll("[data-test-alias]").forEach(p=>{p.addEventListener("click",async x=>{const c=x.currentTarget.getAttribute("data-test-alias");if(!c)return;const d=x.currentTarget;d.disabled=!0,d.innerHTML=`${m("refresh","w-3.5 h-3.5 animate-spin")} <span class="text-[11px] font-sans">Testing...</span>`;try{const l=await v.testDatabase(c);y.success(`Database '${c}' connected (${l.dialect})`)}catch(l){y.error(l instanceof Error?l.message:`Connection test failed for '${c}'`)}finally{d.disabled=!1,d.innerHTML=`${m("activity","w-3.5 h-3.5")} <span class="text-[11px] font-sans">Test</span>`}})}),o.querySelectorAll("[data-delete-alias]").forEach(p=>{p.addEventListener("click",x=>{const c=x.currentTarget.getAttribute("data-delete-alias");c&&B({title:"Disconnect Database",message:`Are you sure you want to disconnect database '${c}'? In-flight queries will be closed.`,confirmText:"Disconnect",danger:!0,onConfirm:async()=>{try{await v.deleteDatabase(c),y.success(`Database '${c}' disconnected`),a()}catch(d){y.error(d instanceof Error?d.message:"Failed to disconnect database")}}})})})}catch{o.innerHTML='<tr><td colspan="5" class="py-8 text-center text-rose-400">Failed to load registered databases.</td></tr>'}}const s=()=>t.classList.add("hidden"),r=()=>{e.classList.add("hidden"),t.classList.remove("hidden"),document.getElementById("new-db-alias")?.focus()};document.getElementById("open-add-db-modal")?.addEventListener("click",r),document.getElementById("close-add-db-modal")?.addEventListener("click",s),document.getElementById("cancel-add-db")?.addEventListener("click",s),t.addEventListener("click",o=>{o.target===t&&s()});const n=o=>{o.key==="Escape"&&!t.classList.contains("hidden")&&s()};window.addEventListener("keydown",n),document.getElementById("add-db-form")?.addEventListener("submit",async o=>{o.preventDefault(),e.classList.add("hidden");const b=document.getElementById("new-db-alias").value.trim(),p=document.getElementById("new-db-engine").value,x=document.getElementById("new-db-url").value.trim(),c=parseInt(document.getElementById("new-db-min").value,10)||1,d=parseInt(document.getElementById("new-db-max").value,10)||10,l=document.getElementById("submit-add-db");l.disabled=!0,l.textContent="Connecting...";try{await v.addDatabase({alias:b,engine:p,url:x,pool_min:c,pool_max:d}),y.success(`Database '${b}' connected successfully`),s(),a()}catch(i){e.textContent=i instanceof Error?i.message:"Failed to add database",e.classList.remove("hidden")}finally{l.disabled=!1,l.textContent="Connect Pool"}}),a()}async function N(u){let t=[];u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">API Keys</h1>
          <p class="text-xs text-secondary mt-0.5">Manage application credentials, rate limits, and cryptographic rotation.</p>
        </div>
        <button id="open-create-key-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors shadow-xs">
          ${m("plus","w-3.5 h-3.5")}
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
    <div id="create-key-modal" class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-md w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Generate API Key</h2>
          <button id="close-create-key-modal" class="text-secondary hover:text-primary p-1">
            ${m("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-key-form" class="space-y-3.5 text-xs">
          <div>
            <label for="key-name-input" class="block text-secondary mb-1">Key Identifier</label>
            <input 
              id="key-name-input" 
              type="text" 
              required 
              placeholder="e.g. backend-microservice" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="key-role-select" class="block text-secondary mb-1">RBAC Role Grant</label>
            <select 
              id="key-role-select" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none"
            >
              <option value="">No Role (Unrestricted Superadmin)</option>
            </select>
          </div>

          <div>
            <label for="key-rate-input" class="block text-secondary mb-1">Rate Limit Override (req/min, 0 = global default)</label>
            <input 
              id="key-rate-input" 
              type="number" 
              value="0" 
              min="0" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="key-secret-input" class="block text-secondary mb-1">Custom Secret (optional, auto-generated if blank)</label>
            <input 
              id="key-secret-input" 
              type="password" 
              placeholder="Leave empty for high-entropy BLAKE3 secret" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div class="flex justify-end space-x-2 pt-3 border-t border-surfaceBorder">
            <button type="button" id="cancel-create-key" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md transition-colors">
              Cancel
            </button>
            <button type="submit" id="submit-create-key" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md transition-colors">
              Generate Key
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center space-x-2 text-accent-orange">
          ${m("shield","w-5 h-5")}
          <h2 class="text-sm font-semibold text-primary">Save Your API Key Credentials</h2>
        </div>
        <p class="text-xs text-secondary leading-relaxed">
          This is the <span class="text-amber-400 font-semibold">ONLY time</span> the key secret will be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">X-Axiom-Key Header Value (Base64)</label>
            <div class="flex items-center space-x-2 bg-background border border-surfaceBorder rounded-md p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-primary text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="p-1.5 text-secondary hover:text-primary rounded hover:bg-surfaceHover transition-colors" title="Copy to clipboard">
                ${m("copy","w-4 h-4")}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-secondary font-medium mb-1">Example cURL Query</label>
            <div class="bg-background border border-surfaceBorder rounded-md p-3 font-mono text-[11px] text-secondary overflow-x-auto relative group">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full py-2.5 bg-accent-orange hover:bg-orange-600 text-white text-xs font-medium rounded-md transition-colors">
          I Have Saved This Key
        </button>
      </div>
    </div>
  `;const e=document.getElementById("create-key-modal"),a=document.getElementById("secret-modal"),s=document.getElementById("create-key-error");async function r(){try{t=await v.getRoles();const d=document.getElementById("key-role-select");d.innerHTML='<option value="">No Role (Unrestricted Superadmin)</option>'+t.map(l=>`<option value="${l.name}">${l.name} (${l.permissions.length} perms)</option>`).join("")}catch{}}function n(d){document.getElementById("secret-token-display").value=d,document.getElementById("secret-curl-display").textContent=`curl -X POST http://localhost:4500/api/v1/db/main_db/query \\
  -H "X-Axiom-Key: ${d}" \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT 1;"}'`,a.classList.remove("hidden")}async function o(){const d=document.getElementById("keys-table-body");try{const l=await v.getKeys();if(l.length===0){d.innerHTML='<tr><td colspan="6" class="py-12 text-center text-secondary">No API keys registered yet. Click "Create Key" to generate one.</td></tr>';return}d.innerHTML=l.map(i=>`
        <tr class="hover:bg-surfaceHover/40 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary">${i.name}</td>
          <td class="py-3 px-4">
            ${i.role_name?`<span class="px-2 py-0.5 rounded text-[11px] bg-accent-orange/10 text-accent-orange border border-accent-orange/20">${i.role_name}</span>`:'<span class="text-secondary text-[11px]">superadmin</span>'}
          </td>
          <td class="py-3 px-4 text-secondary">${i.rate_limit>0?`${i.rate_limit} req/min`:"global"}</td>
          <td class="py-3 px-4 text-secondary">${i.expires_at?new Date(i.expires_at*1e3).toLocaleDateString():"never"}</td>
          <td class="py-3 px-4 text-secondary">${new Date(i.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <div class="inline-flex items-center space-x-1">
              <button 
                data-rotate-key="${i.name}" 
                class="px-2 py-1 text-secondary hover:text-accent-orange rounded hover:bg-surfaceHover transition-colors flex items-center space-x-1" 
                title="Rotate secret"
              >
                ${m("refresh","w-3.5 h-3.5")}
                <span class="text-[11px] font-sans">Rotate</span>
              </button>
              <button 
                data-delete-key="${i.name}" 
                class="p-1 text-secondary hover:text-rose-400 rounded hover:bg-surfaceHover transition-colors" 
                title="Revoke key"
              >
                ${m("trash","w-4 h-4")}
              </button>
            </div>
          </td>
        </tr>
      `).join(""),d.querySelectorAll("[data-rotate-key]").forEach(i=>{i.addEventListener("click",f=>{const g=f.currentTarget.getAttribute("data-rotate-key");g&&B({title:`Rotate Secret for '${g}'`,message:"Rotating the secret invalidates the existing token immediately. External applications using the current token will receive 401 Unauthorized until updated.",confirmText:"Rotate Secret",danger:!0,onConfirm:async()=>{try{const h=await v.rotateKey(g);y.success(`Key '${g}' secret rotated successfully`),n(h.token)}catch(h){y.error(h instanceof Error?h.message:"Rotation failed")}}})})}),d.querySelectorAll("[data-delete-key]").forEach(i=>{i.addEventListener("click",f=>{const g=f.currentTarget.getAttribute("data-delete-key");g&&B({title:`Revoke API Key '${g}'`,message:"Revoking this key permanently deletes it. Any clients configured with this key will immediately be rejected.",confirmText:"Revoke Key",danger:!0,onConfirm:async()=>{try{await v.deleteKey(g),y.success(`API key '${g}' revoked`),o()}catch(h){y.error(h instanceof Error?h.message:"Failed to delete key")}}})})})}catch{d.innerHTML='<tr><td colspan="6" class="py-8 text-center text-rose-400">Failed to load API keys.</td></tr>'}}const b=()=>e.classList.add("hidden"),p=()=>{s.classList.add("hidden"),e.classList.remove("hidden"),document.getElementById("key-name-input")?.focus()};document.getElementById("open-create-key-modal")?.addEventListener("click",p),document.getElementById("close-create-key-modal")?.addEventListener("click",b),document.getElementById("cancel-create-key")?.addEventListener("click",b),e.addEventListener("click",d=>{d.target===e&&b()});const x=()=>a.classList.add("hidden");document.getElementById("close-secret-modal")?.addEventListener("click",x),a.addEventListener("click",d=>{d.target===a&&x()});const c=d=>{d.key==="Escape"&&(e.classList.contains("hidden")||b(),a.classList.contains("hidden")||x())};window.addEventListener("keydown",c),document.getElementById("copy-token-btn")?.addEventListener("click",async()=>{const d=document.getElementById("secret-token-display");await navigator.clipboard.writeText(d.value),y.success("Token copied to clipboard")}),document.getElementById("create-key-form")?.addEventListener("submit",async d=>{d.preventDefault(),s.classList.add("hidden");const l=document.getElementById("key-name-input").value.trim(),i=document.getElementById("key-role-select").value,f=parseInt(document.getElementById("key-rate-input").value,10)||0,g=document.getElementById("key-secret-input").value.trim()||void 0,h=document.getElementById("submit-create-key");h.disabled=!0,h.textContent="Generating...";try{const w=await v.createKey({name:l,role:i||void 0,rate_limit:f,secret:g});y.success(`Key '${l}' generated`),b(),o(),n(w.token_header)}catch(w){s.textContent=w instanceof Error?w.message:"Failed to create key",s.classList.remove("hidden")}finally{h.disabled=!1,h.textContent="Generate Key"}}),await r(),o()}async function O(u){let t=[];u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Roles & Policies</h1>
          <p class="text-xs text-secondary mt-0.5">Define access control policies and granular SQL operation permissions.</p>
        </div>
        <button id="open-create-role-modal" class="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white rounded-md text-xs font-medium transition-colors shadow-xs">
          ${m("plus","w-3.5 h-3.5")}
          <span>Create Role</span>
        </button>
      </div>

      <!-- Roles Table Card -->
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
    <div id="create-role-modal" class="fixed inset-0 bg-black/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <h2 class="text-sm font-semibold text-primary">Create Access Role</h2>
          <button id="close-create-role-modal" class="text-secondary hover:text-primary p-1">
            ${m("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-role-error" class="hidden p-2 rounded bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-role-form" class="space-y-4 text-xs">
          <div>
            <label for="role-name-input" class="block text-secondary mb-1">Role Name</label>
            <input 
              id="role-name-input" 
              type="text" 
              required 
              placeholder="e.g. read_only_analyst" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary font-mono focus:border-focusRing focus:outline-none" 
            />
          </div>

          <div>
            <label for="role-desc-input" class="block text-secondary mb-1">Description</label>
            <input 
              id="role-desc-input" 
              type="text" 
              placeholder="Read-only access to customer analytics" 
              class="w-full px-3 py-2 bg-background border border-surfaceBorder rounded-md text-primary focus:border-focusRing focus:outline-none" 
            />
          </div>

          <!-- Permission Rule Builder -->
          <div class="border border-surfaceBorder rounded-md p-3.5 bg-background space-y-3">
            <div class="font-medium text-primary text-xs flex items-center justify-between">
              <span>Add Permission Rule</span>
              <span class="text-[11px] text-secondary font-mono">Wildcard * supported</span>
            </div>
            
            <div class="grid grid-cols-2 gap-2.5">
              <div>
                <label for="perm-db-input" class="block text-secondary text-[11px] mb-1">Database</label>
                <input id="perm-db-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
              <div>
                <label for="perm-table-input" class="block text-secondary text-[11px] mb-1">Table</label>
                <input id="perm-table-input" type="text" value="*" class="w-full px-2.5 py-1.5 bg-surface border border-surfaceBorder rounded text-primary font-mono text-xs focus:outline-none focus:border-focusRing" />
              </div>
            </div>

            <div>
              <label class="block text-secondary text-[11px] mb-1.5">Permitted Operations</label>
              <div class="flex items-center space-x-4 font-mono">
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
              + Append Rule to Role
            </button>

            <!-- Pending Rules List -->
            <div id="pending-rules-container" class="space-y-1.5 pt-2 border-t border-surfaceBorder">
              <div class="text-[11px] text-secondary">No rules added yet.</div>
            </div>
          </div>

          <div class="flex justify-end space-x-2 pt-2 border-t border-surfaceBorder">
            <button type="button" id="cancel-create-role" class="px-3 py-1.5 bg-surfaceHover hover:bg-surfaceBorder text-secondary hover:text-primary rounded-md transition-colors">
              Cancel
            </button>
            <button type="submit" id="submit-create-role" class="px-3 py-1.5 bg-accent-orange hover:bg-orange-600 text-white font-medium rounded-md transition-colors">
              Save Role
            </button>
          </div>
        </form>
      </div>
    </div>
  `;const e=document.getElementById("create-role-modal"),a=document.getElementById("create-role-error");function s(){const p=document.getElementById("pending-rules-container");if(t.length===0){p.innerHTML='<div class="text-[11px] text-secondary">No rules appended yet. Minimum 1 rule required.</div>';return}p.innerHTML=t.map((x,c)=>`
      <div class="flex items-center justify-between p-2 rounded bg-surface border border-surfaceBorder text-[11px] font-mono">
        <div>
          <span class="text-accent-blue">${x.database}</span>.<span class="text-primary">${x.table_name}</span> &rarr;
          <span class="text-accent-orange font-semibold">[${x.operations.join(", ")}]</span>
        </div>
        <button type="button" data-remove-rule="${c}" class="text-secondary hover:text-rose-400 p-0.5" title="Remove rule">
          ${m("x","w-3.5 h-3.5")}
        </button>
      </div>
    `).join(""),p.querySelectorAll("[data-remove-rule]").forEach(x=>{x.addEventListener("click",c=>{const d=parseInt(c.currentTarget.getAttribute("data-remove-rule")||"0",10);t.splice(d,1),s()})})}async function r(){const p=document.getElementById("roles-table-body");try{const x=await v.getRoles();if(x.length===0){p.innerHTML='<tr><td colspan="5" class="py-12 text-center text-secondary">No custom roles created yet. Click "Create Role" to establish policies.</td></tr>';return}p.innerHTML=x.map(c=>`
        <tr class="hover:bg-surfaceHover/40 transition-colors">
          <td class="py-3 px-4 font-semibold text-primary font-mono">${c.name}</td>
          <td class="py-3 px-4 text-secondary">${c.description||"—"}</td>
          <td class="py-3 px-4">
            <div class="flex flex-wrap gap-1.5 font-mono text-[11px]">
              ${c.permissions.map(d=>`
                <span class="px-2 py-0.5 rounded bg-background border border-surfaceBorder text-primary">
                  <span class="text-accent-blue">${d.database}</span>.<span class="text-primary">${d.table_name}</span>: <span class="text-accent-orange font-medium">${d.operations.join(",")}</span>
                </span>
              `).join("")}
            </div>
          </td>
          <td class="py-3 px-4 text-secondary font-mono">${new Date(c.created_at*1e3).toLocaleDateString()}</td>
          <td class="py-3 px-4 text-right">
            <button data-delete-role="${c.name}" class="p-1 text-secondary hover:text-rose-400 rounded hover:bg-surfaceHover transition-colors" title="Delete role">
              ${m("trash","w-4 h-4")}
            </button>
          </td>
        </tr>
      `).join(""),p.querySelectorAll("[data-delete-role]").forEach(c=>{c.addEventListener("click",d=>{const l=d.currentTarget.getAttribute("data-delete-role");l&&B({title:`Delete Role '${l}'`,message:`Deleting role '${l}' will remove associated permission rules. API keys assigned to this role will lose their scoped capabilities.`,confirmText:"Delete Role",danger:!0,onConfirm:async()=>{try{await v.deleteRole(l),y.success(`Role '${l}' deleted`),r()}catch(i){y.error(i instanceof Error?i.message:"Failed to delete role")}}})})})}catch{p.innerHTML='<tr><td colspan="5" class="py-8 text-center text-rose-400">Failed to load roles.</td></tr>'}}const n=()=>e.classList.add("hidden"),o=()=>{t=[],s(),a.classList.add("hidden"),e.classList.remove("hidden"),document.getElementById("role-name-input")?.focus()};document.getElementById("open-create-role-modal")?.addEventListener("click",o),document.getElementById("close-create-role-modal")?.addEventListener("click",n),document.getElementById("cancel-create-role")?.addEventListener("click",n),e.addEventListener("click",p=>{p.target===e&&n()});const b=p=>{p.key==="Escape"&&!e.classList.contains("hidden")&&n()};window.addEventListener("keydown",b),document.getElementById("add-perm-rule-btn")?.addEventListener("click",()=>{const p=document.getElementById("perm-db-input").value.trim()||"*",x=document.getElementById("perm-table-input").value.trim()||"*",c=[];if(document.getElementById("op-select").checked&&c.push("SELECT"),document.getElementById("op-insert").checked&&c.push("INSERT"),document.getElementById("op-update").checked&&c.push("UPDATE"),document.getElementById("op-delete").checked&&c.push("DELETE"),c.length===0){y.error("Select at least one permitted operation (SELECT, INSERT, UPDATE, or DELETE)");return}t.push({database:p,table_name:x,operations:c}),s(),y.info(`Added rule: ${p}.${x} [${c.join(", ")}]`)}),document.getElementById("create-role-form")?.addEventListener("submit",async p=>{p.preventDefault(),a.classList.add("hidden");const x=document.getElementById("role-name-input").value.trim(),c=document.getElementById("role-desc-input").value.trim()||void 0;if(t.length===0){a.textContent='Add at least one permission rule using the "+ Append Rule to Role" button above.',a.classList.remove("hidden");return}const d=document.getElementById("submit-create-role");d.disabled=!0,d.textContent="Saving...";try{await v.createRole({name:x,description:c,permissions:t}),y.success(`Role '${x}' saved successfully`),n(),r()}catch(l){a.textContent=l instanceof Error?l.message:"Failed to save role",a.classList.remove("hidden")}finally{d.disabled=!1,d.textContent="Save Role"}}),r()}async function K(u){let t=null;u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Cache Engine</h1>
          <p class="text-xs text-secondary mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) telemetry and controls.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="refresh-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${m("refresh","w-3.5 h-3.5")}
            <span>Refresh</span>
          </button>
          <button id="flush-cache-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-md text-xs font-medium transition-colors">
            ${m("trash","w-3.5 h-3.5")}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Cache Metrics Grid -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Overall Hit Ratio</div>
          <div id="cache-hit-rate" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">L1 & L2 combined hits</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">L1 Active Entries</div>
          <div id="cache-entries" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live entries in RAM</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">LRU Evictions</div>
          <div id="cache-evictions" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Capacity threshold evictions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Cache Misses</div>
          <div id="cache-misses" class="text-2xl font-semibold text-secondary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Queries forwarded to DB</div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${m("hard-drive","w-4 h-4 text-accent-blue")}
            <h2 class="text-sm font-semibold text-primary">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-3 text-xs font-mono">
            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-secondary font-sans mt-0.5">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3 rounded bg-background border border-surfaceBorder">
              <div>
                <div class="font-medium text-primary">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-secondary font-sans mt-0.5">Survives server restart and power loss</div>
              </div>
              <div id="l2-hits" class="text-accent-blue font-semibold">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-3 text-xs text-secondary leading-relaxed shadow-xs">
          <h2 class="text-sm font-semibold text-primary">Engine Durability Invariants</h2>
          <p>
            The unified v4 CacheEngine manages query response caching, per-IP/per-key rate limiting windows, and idempotency replay buffers through a single memory footprint.
          </p>
          <ul class="list-disc pl-5 space-y-1.5 pt-1">
            <li><strong class="text-primary font-normal">L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong class="text-primary font-normal">TTL Sweep:</strong> Background BinaryHeap min-heap eviction daemon executing on 60s intervals.</li>
            <li><strong class="text-primary font-normal">Cache Stampede Guard:</strong> Single-flight query deduplication prevents downstream thundering herds.</li>
          </ul>
        </div>
      </div>
    </div>
  `;async function e(){try{const s=await v.getCacheStats(),r=s.hits_l1+s.hits_l2,n=r+s.misses,o=n>0?(r/n*100).toFixed(1):"0.0";document.getElementById("cache-hit-rate").textContent=`${o}%`,document.getElementById("cache-entries").textContent=String(s.entries_count),document.getElementById("cache-evictions").textContent=String(s.evictions),document.getElementById("cache-misses").textContent=String(s.misses),document.getElementById("l1-hits").textContent=`${s.hits_l1} hits`,document.getElementById("l2-hits").textContent=`${s.hits_l2} hits`}catch{}}document.getElementById("refresh-cache-btn")?.addEventListener("click",async()=>{await e(),y.info("Cache telemetry updated")}),document.getElementById("flush-cache-btn")?.addEventListener("click",()=>{B({title:"Flush Cache Engine",message:"Are you sure you want to flush all L1 RAM and L2 persistent cache entries? Upstream databases will absorb full query traffic until cache re-warms.",confirmText:"Flush All",danger:!0,onConfirm:async()=>{try{await v.flushCache(),y.success("Cache flushed successfully"),e()}catch(s){y.error(s instanceof Error?s.message:"Flush failed")}}})}),e(),t=setInterval(e,5e3);const a=()=>{t&&clearInterval(t),window.removeEventListener("hashchange",a)};window.addEventListener("hashchange",a)}async function U(u){let t=!0,e=null,a="ALL",s="",r=[];u.innerHTML=`
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
            placeholder="Search events or targets..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-48 sm:w-60"
          />

          <!-- Pause / Resume Button -->
          <button id="toggle-tail-btn" class="px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs font-medium text-primary transition-colors flex items-center space-x-1.5">
            <span id="tail-status-indicator" class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span id="tail-btn-text">Live Tail</span>
          </button>

          <!-- Clear Console -->
          <button id="clear-logs-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Clear buffer">
            ${m("trash","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Log Terminal Display Card -->
      <div class="bg-[#141416] border border-surfaceBorder rounded-lg overflow-hidden shadow-sm flex flex-col font-mono text-xs">
        <div class="bg-surface px-4 py-2.5 border-b border-surfaceBorder flex items-center justify-between text-[11px] text-secondary">
          <div class="flex items-center space-x-2">
            ${m("file-text","w-3.5 h-3.5 text-accent-orange")}
            <span class="font-medium text-primary">axiom-event-stream</span>
          </div>
          <span id="log-count-indicator">0 events</span>
        </div>

        <div id="log-console-body" class="p-3 sm:p-4 space-y-1 overflow-y-auto max-h-[640px] min-h-[380px] divide-y divide-white/5">
          <div class="text-secondary py-12 text-center font-sans">Connecting to live event stream...</div>
        </div>
      </div>
    </div>
  `;function n(){const d=document.getElementById("log-console-body");if(!d)return;const l=r.filter(f=>{const g=a==="ALL"||f.level===a,h=!s||f.message.toLowerCase().includes(s)||f.target.toLowerCase().includes(s)||f.details&&f.details.toLowerCase().includes(s);return g&&h}),i=document.getElementById("log-count-indicator");if(i&&(i.textContent=`${l.length} events`),l.length===0){d.innerHTML='<div class="text-secondary py-12 text-center font-sans">No log events matching active filter.</div>';return}d.innerHTML=l.map(f=>{let g="text-emerald-400 bg-emerald-500/10 border-emerald-500/20";return f.level==="WARN"?g="text-amber-400 bg-amber-500/10 border-amber-500/20":f.level==="ERROR"&&(g="text-rose-400 bg-rose-500/10 border-rose-500/20"),`
        <div class="pt-1 flex items-start space-x-2.5 text-[11px] leading-relaxed hover:bg-white/[0.02] px-1 rounded transition-colors">
          <span class="text-secondary/60 shrink-0 select-none">${new Date(f.timestamp*1e3).toISOString().replace("T"," ").substring(11,19)}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border shrink-0 ${g}">${f.level}</span>
          <span class="text-accent-blue font-semibold shrink-0">[${f.target}]</span>
          <span class="text-primary flex-1 break-all">${f.message}</span>
          ${f.details?`<span class="text-secondary/70 text-[10px] shrink-0 truncate max-w-xs">{${f.details}}</span>`:""}
        </div>
      `}).join(""),t&&(d.scrollTop=d.scrollHeight)}async function o(){try{r=(await v.getAuditLog(100,0)).map(l=>{let i="INFO";return l.action.includes("delete")||l.action.includes("fail")||l.action.includes("rotate")?i="WARN":(l.action.includes("ban")||l.action.includes("error"))&&(i="ERROR"),{id:l.id,timestamp:l.timestamp,level:i,target:l.target,message:`${l.actor} executed ${l.action}`,details:l.details}}),n()}catch{}}document.getElementById("log-level-filter")?.addEventListener("change",d=>{a=d.target.value,n()}),document.getElementById("log-search-input")?.addEventListener("input",d=>{s=d.target.value.trim().toLowerCase(),n()});const b=document.getElementById("toggle-tail-btn"),p=document.getElementById("tail-status-indicator"),x=document.getElementById("tail-btn-text");b?.addEventListener("click",()=>{t=!t,t?(p?.classList.remove("bg-amber-500"),p?.classList.add("bg-emerald-500","animate-pulse"),x&&(x.textContent="Live Tail"),o(),e=setInterval(o,2500),y.info("Log live-tail resumed")):(p?.classList.remove("bg-emerald-500","animate-pulse"),p?.classList.add("bg-amber-500"),x&&(x.textContent="Paused"),e&&clearInterval(e),y.info("Log live-tail paused"))}),document.getElementById("clear-logs-btn")?.addEventListener("click",()=>{r=[],n(),y.info("Log buffer cleared")}),await o(),e=setInterval(o,2500);const c=()=>{e&&clearInterval(e),window.removeEventListener("hashchange",c)};window.addEventListener("hashchange",c)}async function F(u){let t=[],e="",a=0;const s=20;u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 class="text-xl font-semibold text-primary">Audit Trail</h1>
          <p class="text-xs text-secondary mt-0.5">Immutable record of control plane mutations, credential issuance, and security actions.</p>
        </div>
        <div class="flex items-center space-x-2">
          <input 
            id="audit-search" 
            type="text" 
            placeholder="Filter by action, actor, target..." 
            class="px-3 py-1.5 bg-surface border border-surfaceBorder rounded-md text-xs text-primary focus:outline-none focus:border-focusRing w-56 sm:w-64"
          />
          <button id="refresh-audit-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh audit log">
            ${m("refresh","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Audit Table Card -->
      <div class="bg-surface border border-surfaceBorder rounded-lg overflow-hidden shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs text-secondary">
            <thead class="bg-background text-[11px] font-semibold uppercase tracking-wider text-secondary border-b border-surfaceBorder">
              <tr>
                <th class="py-3 px-4">Event ID</th>
                <th class="py-3 px-4">Timestamp</th>
                <th class="py-3 px-4">Actor</th>
                <th class="py-3 px-4">Action</th>
                <th class="py-3 px-4">Target</th>
                <th class="py-3 px-4">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-surfaceBorder font-mono">
              <tr>
                <td colspan="6" class="py-8 text-center text-secondary">Loading audit trail...</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls -->
        <div class="p-3 bg-background border-t border-surfaceBorder flex items-center justify-between text-xs text-secondary">
          <span id="page-indicator">Showing 0 events</span>
          <div class="flex space-x-2">
            <button id="prev-page-btn" disabled class="px-3 py-1 bg-surface border border-surfaceBorder rounded text-secondary hover:text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Previous
            </button>
            <button id="next-page-btn" disabled class="px-3 py-1 bg-surface border border-surfaceBorder rounded text-secondary hover:text-primary disabled:opacity-40 disabled:pointer-events-none transition-colors">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <div id="audit-detail-modal" class="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
      <div class="bg-surface border border-surfaceBorder rounded-lg max-w-lg w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center justify-between pb-2 border-b border-surfaceBorder">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${m("file-text","w-4 h-4 text-accent-orange")}
            <span id="modal-event-title">Event Detail</span>
          </div>
          <button id="close-audit-detail" class="text-secondary hover:text-primary p-1">
            ${m("x","w-4 h-4")}
          </button>
        </div>
        <div class="space-y-3 text-xs font-mono">
          <div class="bg-background p-3 rounded border border-surfaceBorder overflow-x-auto max-h-[360px] overflow-y-auto">
            <pre id="modal-event-json" class="text-secondary leading-relaxed whitespace-pre-wrap"></pre>
          </div>
        </div>
        <button id="close-audit-detail-btn" class="w-full py-2 bg-surfaceHover hover:bg-surfaceBorder text-primary text-xs font-medium rounded-md transition-colors">
          Close
        </button>
      </div>
    </div>
  `;const r=document.getElementById("audit-detail-modal");function n(c){document.getElementById("modal-event-title").textContent=`Event #${c.id} — ${c.action}`;let d=c.details||"No additional payload metadata";try{if(c.details){const i=JSON.parse(c.details);d=JSON.stringify(i,null,2)}}catch{}const l={id:c.id,timestamp:new Date(c.timestamp*1e3).toISOString(),actor:c.actor,action:c.action,target:c.target,details:d};document.getElementById("modal-event-json").textContent=JSON.stringify(l,null,2),r.classList.remove("hidden")}const o=()=>r.classList.add("hidden");document.getElementById("close-audit-detail")?.addEventListener("click",o),document.getElementById("close-audit-detail-btn")?.addEventListener("click",o),r.addEventListener("click",c=>{c.target===r&&o()});const b=c=>{c.key==="Escape"&&!r.classList.contains("hidden")&&o()};window.addEventListener("keydown",b);function p(){const c=document.getElementById("audit-table-body"),d=t.filter(w=>!e||w.action.toLowerCase().includes(e)||w.target.toLowerCase().includes(e)||w.actor.toLowerCase().includes(e)),l=a*s,i=d.slice(l,l+s);if(i.length===0){c.innerHTML='<tr><td colspan="6" class="py-12 text-center text-secondary font-sans">No matching audit events recorded.</td></tr>',document.getElementById("page-indicator").textContent=`Showing 0 of ${d.length} events`;return}c.innerHTML=i.map((w,E)=>`
      <tr class="hover:bg-surfaceHover/40 transition-colors cursor-pointer" data-audit-idx="${l+E}">
        <td class="py-2.5 px-4 text-secondary text-[11px]">#${w.id}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px]">${new Date(w.timestamp*1e3).toLocaleString()}</td>
        <td class="py-2.5 px-4 font-semibold text-primary">${w.actor}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[11px] font-mono font-semibold uppercase bg-accent-orange/10 text-accent-orange border border-accent-orange/20">
            ${w.action}
          </span>
        </td>
        <td class="py-2.5 px-4 text-primary font-medium">${w.target}</td>
        <td class="py-2.5 px-4 text-secondary text-[11px] truncate max-w-xs">${w.details||"—"}</td>
      </tr>
    `).join(""),c.querySelectorAll("[data-audit-idx]").forEach(w=>{w.addEventListener("click",E=>{const I=parseInt(E.currentTarget.getAttribute("data-audit-idx")||"0",10);d[I]&&n(d[I])})});const f=Math.ceil(d.length/s);document.getElementById("page-indicator").textContent=`Page ${a+1} of ${f||1} (${d.length} total events)`;const g=document.getElementById("prev-page-btn"),h=document.getElementById("next-page-btn");g.disabled=a===0,h.disabled=l+s>=d.length}async function x(){try{t=await v.getAuditLog(500,0),p()}catch{const c=document.getElementById("audit-table-body");c.innerHTML='<tr><td colspan="6" class="py-8 text-center text-rose-400 font-sans">Failed to load audit records.</td></tr>'}}document.getElementById("audit-search")?.addEventListener("input",c=>{e=c.target.value.trim().toLowerCase(),a=0,p()}),document.getElementById("prev-page-btn")?.addEventListener("click",()=>{a>0&&(a--,p())}),document.getElementById("next-page-btn")?.addEventListener("click",()=>{a++,p()}),document.getElementById("refresh-audit-btn")?.addEventListener("click",async()=>{await x(),y.info("Audit log refreshed")}),x()}function Q(u){const t=u.split(`
`),e=[];for(const a of t){const s=a.trim();if(!s||s.startsWith("#"))continue;const r=s.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([0-9.eE+-]+)/);if(!r)continue;const n=r[1],o=r[2]||"",b=parseFloat(r[3]),p={};if(o){const x=o.split(",");for(const c of x){const[d,l]=c.split("=");d&&l&&(p[d.trim()]=l.trim().replace(/^"|"$/g,""))}}e.push({name:n,labels:p,value:b})}return e}async function z(u){let t=!1;u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">Prometheus Metrics</h1>
          <p class="text-xs text-secondary mt-0.5">Runtime telemetry exported at <code class="text-accent-orange font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="toggle-raw-btn" class="px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            Toggle Raw Feed
          </button>
          <button id="copy-raw-metrics" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${m("copy","w-3.5 h-3.5")}
            <span>Copy Text</span>
          </button>
          <button id="refresh-metrics-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh metrics">
            ${m("refresh","w-4 h-4")}
          </button>
        </div>
      </div>

      <!-- Telemetry Visual Cards -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">HTTP Requests (Total)</div>
          <div id="metric-http-total" class="text-2xl font-semibold text-primary font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Gateway inbound queries</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Database Queries</div>
          <div id="metric-db-total" class="text-2xl font-semibold text-accent-blue font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Upstream SQL executions</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Active Pool Conns</div>
          <div id="metric-conns-total" class="text-2xl font-semibold text-emerald-400 font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">Live connected sockets</div>
        </div>

        <div class="bg-surface border border-surfaceBorder p-4 rounded-lg shadow-xs">
          <div class="text-xs text-secondary mb-1">Rate Limit Drops</div>
          <div id="metric-rl-total" class="text-2xl font-semibold text-accent-orange font-mono">—</div>
          <div class="text-[11px] text-secondary mt-1">429 Too Many Requests</div>
        </div>
      </div>

      <!-- Breakdown Panels -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Endpoint Activity Breakdown -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${m("activity","w-4 h-4 text-accent-orange")}
            <h2 class="text-sm font-semibold text-primary">Inbound HTTP Operations</h2>
          </div>
          <div id="http-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-secondary py-4 text-center">Parsing telemetry...</div>
          </div>
        </div>

        <!-- Database Activity Breakdown -->
        <div class="bg-surface border border-surfaceBorder p-5 rounded-lg space-y-4 shadow-xs">
          <div class="flex items-center space-x-2">
            ${m("database","w-4 h-4 text-accent-blue")}
            <h2 class="text-sm font-semibold text-primary">Database Query Distribution</h2>
          </div>
          <div id="db-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-secondary py-4 text-center">Parsing telemetry...</div>
          </div>
        </div>
      </div>

      <!-- Raw Exposition Block (Collapsible) -->
      <div id="raw-metrics-section" class="bg-surface border border-surfaceBorder rounded-lg p-4 space-y-3 hidden shadow-xs">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-primary">Raw Prometheus 0.0.4 Output</span>
          <span class="text-[11px] text-secondary font-mono">text/plain</span>
        </div>
        <div class="bg-background border border-surfaceBorder rounded-md p-4 overflow-x-auto max-h-[480px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-[11px] text-secondary leading-relaxed whitespace-pre">Loading metrics...</pre>
        </div>
      </div>
    </div>
  `;let e="";async function a(){try{e=await v.getRawMetrics();const s=document.getElementById("raw-metrics-display");s&&(s.textContent=e);const r=Q(e),n=r.filter(i=>i.name.includes("http_requests_total")).reduce((i,f)=>i+f.value,0);document.getElementById("metric-http-total").textContent=String(n);const o=r.filter(i=>i.name.includes("db_queries_total")).reduce((i,f)=>i+f.value,0);document.getElementById("metric-db-total").textContent=String(o);const b=r.filter(i=>i.name.includes("pool_connections_active")).reduce((i,f)=>i+f.value,0);document.getElementById("metric-conns-total").textContent=String(b);const p=r.filter(i=>i.name.includes("rate_limit_rejections_total")||i.name.includes("rate_limit_rejected")).reduce((i,f)=>i+f.value,0);document.getElementById("metric-rl-total").textContent=String(p);const x=r.filter(i=>i.name.includes("http_requests_total")),c=document.getElementById("http-breakdown-list");x.length>0?c.innerHTML=x.map(i=>`
          <div class="flex items-center justify-between p-2 rounded bg-background border border-surfaceBorder text-[11px]">
            <div class="flex items-center space-x-2">
              <span class="px-1.5 py-0.5 rounded bg-surfaceHover font-semibold uppercase">${i.labels.method||"GET"}</span>
              <span class="text-primary truncate max-w-xs">${i.labels.path||"/"}</span>
              ${i.labels.status?`<span class="text-secondary">(${i.labels.status})</span>`:""}
            </div>
            <span class="text-emerald-400 font-semibold">${i.value} calls</span>
          </div>
        `).join(""):c.innerHTML='<div class="text-secondary py-4 text-center">No HTTP requests recorded since startup.</div>';const d=r.filter(i=>i.name.includes("db_queries_total")),l=document.getElementById("db-breakdown-list");d.length>0?l.innerHTML=d.map(i=>`
          <div class="flex items-center justify-between p-2 rounded bg-background border border-surfaceBorder text-[11px]">
            <div class="flex items-center space-x-2">
              <span class="px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue border border-accent-blue/20 font-semibold uppercase">
                ${i.labels.alias||"main"}
              </span>
              <span class="text-primary">${i.labels.operation||"QUERY"}</span>
            </div>
            <span class="text-accent-orange font-semibold">${i.value} queries</span>
          </div>
        `).join(""):l.innerHTML='<div class="text-secondary py-4 text-center">No database queries recorded since startup.</div>'}catch{const s=document.getElementById("raw-metrics-display");s&&(s.textContent="Failed to scrape /metrics endpoint.")}}document.getElementById("refresh-metrics-btn")?.addEventListener("click",async()=>{await a(),y.info("Metrics refreshed")}),document.getElementById("toggle-raw-btn")?.addEventListener("click",()=>{t=!t;const s=document.getElementById("raw-metrics-section");s&&(t?s.classList.remove("hidden"):s.classList.add("hidden"))}),document.getElementById("copy-raw-metrics")?.addEventListener("click",async()=>{e&&(await navigator.clipboard.writeText(e),y.success("Prometheus exposition copied to clipboard"))}),a()}async function G(u){u.innerHTML=`
    <div class="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-primary">System Information</h1>
          <p class="text-xs text-secondary mt-0.5">Runtime architecture, kernel diagnostics, and memory subsystem telemetry.</p>
        </div>
        <div class="flex items-center space-x-2">
          <button id="copy-sys-diag-btn" class="flex items-center space-x-1.5 px-3 py-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-xs text-secondary hover:text-primary transition-colors">
            ${m("copy","w-3.5 h-3.5")}
            <span>Copy Diagnostics</span>
          </button>
          <button id="refresh-sys-btn" class="p-1.5 bg-surface hover:bg-surfaceHover border border-surfaceBorder rounded-md text-secondary hover:text-primary transition-colors" title="Refresh diagnostics">
            ${m("refresh","w-4 h-4")}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4 shadow-xs">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${m("server","w-4 h-4 text-accent-orange")}
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Binary Version</span>
              <span class="text-primary font-bold">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Async Runtime</span>
              <span class="text-primary">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Memory Allocator</span>
              <span class="text-primary">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Metadata Store</span>
              <span class="text-primary">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary font-sans">Protocol Handlers</span>
              <span class="text-primary">HTTP/1.1 REST + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics -->
        <div class="bg-surface border border-surfaceBorder rounded-lg p-5 space-y-4 shadow-xs">
          <div class="flex items-center space-x-2 text-primary font-semibold text-sm">
            ${m("activity","w-4 h-4 text-emerald-400")}
            <span>Live Process Diagnostics</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Process Uptime</span>
              <span id="sys-uptime" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Process CPU Utilization</span>
              <span id="sys-cpu" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5 border-b border-surfaceBorder">
              <span class="text-secondary font-sans">Active Connection Pools</span>
              <span id="sys-pools" class="text-primary font-semibold">—</span>
            </div>
            <div class="flex justify-between py-1.5">
              <span class="text-secondary font-sans">Registered Client Keys</span>
              <span id="sys-keys" class="text-primary font-semibold">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;let t="";async function e(){try{const a=await v.getStatus(),s=Math.floor(a.uptime_seconds/60),r=s<60?`${s} minutes`:`${Math.floor(s/60)}h ${s%60}m`;document.getElementById("sys-uptime").textContent=r,document.getElementById("sys-mem").textContent=`${a.memory_mb} MB`,document.getElementById("sys-cpu").textContent=`${a.cpu_percent.toFixed(1)}%`,document.getElementById("sys-pools").textContent=`${a.active_databases} pools`,document.getElementById("sys-keys").textContent=`${a.registered_keys} keys`,t=JSON.stringify(a,null,2)}catch{}}document.getElementById("refresh-sys-btn")?.addEventListener("click",async()=>{await e(),y.info("Diagnostics updated")}),document.getElementById("copy-sys-diag-btn")?.addEventListener("click",async()=>{t&&(await navigator.clipboard.writeText(t),y.success("System diagnostics copied to clipboard"))}),e()}const L=document.getElementById("app");let k=!1;async function R(){const u=window.location.hash||"#/overview";try{if((await v.checkSetupStatus()).setup_required){if(u!=="#/setup"){window.location.hash="#/setup";return}j(L);return}else if(u==="#/setup"){window.location.hash="#/login";return}}catch{}if(u==="#/login"){q(L);return}if(!localStorage.getItem("axiom_session_token")){window.location.hash="#/login";return}const e=u.replace("#/","").split("?")[0]||"overview";L.innerHTML=`
    <div class="min-h-screen bg-background flex flex-col selection:bg-accent-orange selection:text-white">
      <div id="navbar-container"></div>
      <div class="flex-1 flex overflow-hidden">
        <div id="sidebar-container"></div>
        <main id="main-content" class="flex-1 overflow-y-auto bg-background focus:outline-none"></main>
      </div>
    </div>
  `;const a=()=>{k=!k,r()},s=()=>{k&&(k=!1,r())},r=()=>{const b=document.getElementById("sidebar-container");b&&(b.innerHTML=S(e,k,s),document.getElementById("sidebar-close-btn")?.addEventListener("click",s))},n=document.getElementById("navbar-container");n.innerHTML=H(a),r();const o=document.getElementById("main-content");switch(o.scrollTop=0,e){case"overview":C(o);break;case"databases":_(o);break;case"keys":N(o);break;case"roles":O(o);break;case"cache":K(o);break;case"logs":U(o);break;case"audit":F(o);break;case"metrics":z(o);break;case"system":G(o);break;default:C(o);break}}window.addEventListener("keydown",u=>{if(u.key==="Escape"&&k){k=!1;const t=document.getElementById("sidebar-container");if(t){const e=(window.location.hash||"#/overview").replace("#/","").split("?")[0]||"overview";t.innerHTML=S(e,!1,()=>{})}}});window.addEventListener("hashchange",()=>{k=!1,R()});R();
