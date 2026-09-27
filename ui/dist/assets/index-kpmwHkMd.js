var _=Object.defineProperty;var N=(m,t,e)=>t in m?_(m,t,{enumerable:!0,configurable:!0,writable:!0,value:e}):m[t]=e;var M=(m,t,e)=>N(m,typeof t!="symbol"?t+"":t,e);(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))a(s);new MutationObserver(s=>{for(const n of s)if(n.type==="childList")for(const i of n.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&a(i)}).observe(document,{childList:!0,subtree:!0});function e(s){const n={};return s.integrity&&(n.integrity=s.integrity),s.referrerPolicy&&(n.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?n.credentials="include":s.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function a(s){if(s.ep)return;s.ep=!0;const n=e(s);fetch(s.href,n)}})();class z{getHeaders(){const t={"Content-Type":"application/json",Accept:"application/json"},e=localStorage.getItem("axiom_session_token");return e&&(t.Authorization=`Bearer ${e}`),t}async request(t,e={}){const a=t.startsWith("/")?t:`/${t}`,s=await fetch(a,{...e,headers:{...this.getHeaders(),...e.headers||{}}});if(s.status===401&&!window.location.hash.includes("#/login")&&!window.location.hash.includes("#/setup")&&(localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username"),window.location.hash="#/login"),(s.headers.get("content-type")||"").includes("text/plain")){const p=await s.text();if(!s.ok)throw new Error(p||`HTTP ${s.status}`);return p}const i=await s.json();if(!i.success&&i.error)throw new Error(i.error.message||i.error.code||"API error");return i.data}async checkSetupStatus(){return this.request("/admin/v1/setup/begin",{method:"POST"})}async createAdminAccount(t){return this.request("/admin/v1/setup/account",{method:"POST",body:JSON.stringify(t)})}async setupDatabase(t){return this.request("/admin/v1/setup/database",{method:"POST",body:JSON.stringify(t)})}async completeSetup(){return this.request("/admin/v1/setup/complete",{method:"POST"})}async login(t){return this.request("/admin/v1/auth/login",{method:"POST",body:JSON.stringify(t)})}async logout(){try{await this.request("/admin/v1/auth/logout",{method:"POST"})}finally{localStorage.removeItem("axiom_session_token"),localStorage.removeItem("axiom_username")}}async getStatus(){return this.request("/admin/v1/status")}async getDatabases(){return this.request("/admin/v1/databases")}async addDatabase(t){return this.request("/admin/v1/databases",{method:"POST",body:JSON.stringify(t)})}async deleteDatabase(t){return this.request(`/admin/v1/databases/${encodeURIComponent(t)}`,{method:"DELETE"})}async getKeys(){return this.request("/admin/v1/keys")}async createKey(t){return this.request("/admin/v1/keys",{method:"POST",body:JSON.stringify(t)})}async deleteKey(t){return this.request(`/admin/v1/keys/${encodeURIComponent(t)}`,{method:"DELETE"})}async getRoles(){return this.request("/admin/v1/roles")}async createRole(t){return this.request("/admin/v1/roles",{method:"POST",body:JSON.stringify(t)})}async updateRole(t,e){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"PATCH",body:JSON.stringify(e)})}async deleteRole(t){return this.request(`/admin/v1/roles/${encodeURIComponent(t)}`,{method:"DELETE"})}async getCacheStats(){return this.request("/admin/v1/cache/stats")}async flushCache(){return this.request("/admin/v1/cache/flush",{method:"POST"})}async getAuditLog(t=100,e=0){return this.request(`/admin/v1/audit?limit=${t}&offset=${e}`)}async testDatabase(t){return this.request(`/admin/v1/databases/${encodeURIComponent(t)}/test`)}async rotateKey(t){return this.request(`/admin/v1/keys/${encodeURIComponent(t)}/rotate`,{method:"POST"})}async reloadMetadata(){return this.request("/admin/v1/reload",{method:"POST"})}async getHealth(){return this.request("/health")}async getRawMetrics(){return this.request("/metrics")}}const k=new z;function d(m,t="w-4 h-4"){const e=`class="${t} inline-block shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"`;switch(m){case"dashboard":return`<svg ${e}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;case"database":return`<svg ${e}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>`;case"key":return`<svg ${e}><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`;case"shield":return`<svg ${e}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`;case"hard-drive":return`<svg ${e}><line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/></svg>`;case"file-text":return`<svg ${e}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>`;case"activity":return`<svg ${e}><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.48 12H2"/></svg>`;case"server":return`<svg ${e}><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`;case"plus":return`<svg ${e}><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;case"trash":return`<svg ${e}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;case"refresh":return`<svg ${e}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>`;case"copy":return`<svg ${e}><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;case"check":return`<svg ${e}><path d="M20 6 9 17l-5-5"/></svg>`;case"logout":return`<svg ${e}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>`;case"menu":return`<svg ${e}><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/></svg>`;case"x":return`<svg ${e}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;case"search":return`<svg ${e}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;case"chevron-down":return`<svg ${e}><path d="m6 9 6 6 6-6"/></svg>`;case"chevron-left":return`<svg ${e}><path d="m15 18-6-6 6-6"/></svg>`;case"chevron-right":return`<svg ${e}><path d="m9 18 6-6-6-6"/></svg>`;case"arrow-up-right":return`<svg ${e}><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`;case"arrow-down-right":return`<svg ${e}><path d="M7 17h10V7"/><path d="M7 7l10 10"/></svg>`;case"user":return`<svg ${e}><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;case"settings":return`<svg ${e}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;case"sparkles":return`<svg ${e}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>`;case"moon":return`<svg ${e}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;case"sun":return`<svg ${e}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`;default:return`<svg ${e}><circle cx="12" cy="12" r="10"/></svg>`}}class O{constructor(){M(this,"container",null)}ensureContainer(){return(!this.container||!document.body.contains(this.container))&&(this.container=document.createElement("div"),this.container.id="axiom-toast-container",this.container.className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full px-4",document.body.appendChild(this.container)),this.container}show(t,e="info",a=3500){const s=this.ensureContainer(),n=document.createElement("div");n.className=`
      pointer-events-auto flex items-center space-x-3 px-3.5 py-2.5 rounded-lg border shadow-2xl text-xs font-medium
      transition-all duration-200 transform translate-y-2 opacity-0 select-none
      ${e==="success"?"bg-[#0e0e0e] border-emerald-500/40 text-emerald-400":e==="error"?"bg-[#0e0e0e] border-rose-500/40 text-rose-400":"bg-[#0e0e0e] border-[#262626] text-white"}
    `;const i=e==="success"?d("check","w-4 h-4 text-emerald-400 shrink-0"):e==="error"?d("x","w-4 h-4 text-rose-400 shrink-0"):d("activity","w-4 h-4 text-[#3b82f6] shrink-0");n.innerHTML=`
      ${i}
      <span class="flex-1 text-[#f3f4f6] leading-tight">${t}</span>
      <button class="toast-close text-[#8c8c8c] hover:text-white p-0.5 ml-2 transition-colors cursor-pointer">
        ${d("x","w-3.5 h-3.5")}
      </button>
    `,s.appendChild(n),requestAnimationFrame(()=>{n.classList.remove("translate-y-2","opacity-0"),n.classList.add("translate-y-0","opacity-100")});const p=()=>{n.classList.remove("opacity-100","translate-y-0"),n.classList.add("opacity-0","translate-y-2"),setTimeout(()=>{n.parentElement&&n.parentElement.removeChild(n)},200)},o=setTimeout(p,a);n.querySelector(".toast-close")?.addEventListener("click",()=>{clearTimeout(o),p()})}success(t,e=3e3){this.show(t,"success",e)}error(t,e=4500){this.show(t,"error",e)}info(t,e=3e3){this.show(t,"info",e)}}const v=new O;function S(m){const t=document.getElementById("axiom-confirm-modal");t&&t.remove();const e=document.createElement("div");e.id="axiom-confirm-modal",e.className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 transition-opacity select-none",e.innerHTML=`
    <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-sm w-full p-5 space-y-4 shadow-2xl transform transition-transform scale-95 animate-in">
      <div class="flex items-center space-x-2.5 text-white font-semibold text-sm">
        ${m.danger?d("trash","w-4 h-4 text-[#ef4444]"):d("shield","w-4 h-4 text-[#f38020]")}
        <span>${m.title}</span>
      </div>
      <p class="text-xs text-[#8c8c8c] leading-relaxed">${m.message}</p>
      <div class="flex justify-end space-x-2 pt-2">
        <button id="axiom-confirm-cancel" class="h-8 px-3 rounded-md bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white text-xs font-medium transition-colors cursor-pointer">
          ${m.cancelText||"Cancel"}
        </button>
        <button id="axiom-confirm-ok" class="h-8 px-3.5 rounded-md ${m.danger?"bg-[#ef4444] hover:bg-red-600":"bg-[#f38020] hover:bg-[#e07018]"} text-white text-xs font-medium transition-colors shadow-xs cursor-pointer">
          ${m.confirmText||"Confirm"}
        </button>
      </div>
    </div>
  `,document.body.appendChild(e);const a=()=>e.remove(),s=e.querySelector("#axiom-confirm-cancel"),n=e.querySelector("#axiom-confirm-ok");s.focus(),s.addEventListener("click",a),e.addEventListener("click",p=>{p.target===e&&a()});const i=p=>{p.key==="Escape"&&(window.removeEventListener("keydown",i),a())};window.addEventListener("keydown",i),n.addEventListener("click",async()=>{n.disabled=!0,n.textContent="Processing...";try{await m.onConfirm()}finally{window.removeEventListener("keydown",i),a()}})}function Q(m){const t=localStorage.getItem("axiom_username")||"admin";return setTimeout(()=>{document.getElementById("mobile-menu-btn")?.addEventListener("click",m);const e=document.getElementById("user-menu-btn"),a=document.getElementById("user-popover-menu");e&&a&&(e.addEventListener("click",o=>{o.stopPropagation(),!a.classList.contains("hidden")?a.classList.add("hidden"):a.classList.remove("hidden")}),document.addEventListener("click",o=>{!e.contains(o.target)&&!a.contains(o.target)&&a.classList.add("hidden")})),document.getElementById("reload-meta-btn")?.addEventListener("click",async()=>{const o=document.getElementById("reload-meta-btn");if(o){o.disabled=!0,o.classList.add("opacity-50");try{await k.reloadMetadata(),v.success("Metadata snapshot refreshed from axiom.db")}catch(x){v.error(x instanceof Error?x.message:"Reload failed")}finally{o.disabled=!1,o.classList.remove("opacity-50")}}});const s=async()=>{await k.logout(),v.info("Signed out of administrative console"),window.location.hash="#/login"};document.getElementById("logout-btn")?.addEventListener("click",s),document.getElementById("popover-logout-btn")?.addEventListener("click",s);const n=async()=>{const o=document.getElementById("navbar-health-dot"),x=document.getElementById("navbar-health-text");if(!o||!x)return;const f=performance.now();try{const u=await k.getHealth(),b=Math.round(performance.now()-f);u.status==="ok"?(o.className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse",x.textContent=`Online (${b}ms)`):(o.className="w-2 h-2 rounded-full bg-amber-400",x.textContent="Degraded")}catch{o.className="w-2 h-2 rounded-full bg-rose-500",x.textContent="Disconnected"}};n();const i=setInterval(n,15e3),p=()=>{clearInterval(i),window.removeEventListener("hashchange",p)};window.addEventListener("hashchange",p)},0),`
    <header class="h-[58px] bg-[#000000] shrink-0 border-b border-[#222222] flex items-center px-4 z-20 sticky top-0 gap-2 select-none">
      <!-- Mobile drawer toggle -->
      <button
        id="mobile-menu-btn"
        class="p-1.5 -ml-1 text-[#8c8c8c] hover:text-white rounded-lg md:hidden hover:bg-[#161616] transition-colors cursor-pointer"
        aria-label="Toggle navigation"
        type="button"
      >
        ${d("menu","w-5 h-5")}
      </button>

      <!-- Brand icon on mobile -->
      <div class="flex items-center gap-2 md:hidden">
        <div class="size-6 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider">
          AX
        </div>
        <span class="font-semibold text-sm text-white tracking-tight">Axiom</span>
      </div>

      <!-- Right controls matching Cloudflare CollapsedHeader -->
      <div class="ml-auto flex items-center gap-2">
        <!-- Live Gateway Ping Status -->
        <div id="navbar-health-pill" class="hidden sm:flex items-center gap-2 text-xs text-[#8c8c8c] bg-[#0c0c0c] px-3 py-1.5 rounded-lg border border-[#262626]">
          <span id="navbar-health-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span id="navbar-health-text" class="font-mono">Online</span>
        </div>

        <!-- Reload Config Button -->
        <button 
          id="reload-meta-btn"
          type="button"
          title="Hot-reload metadata snapshot from axiom.db"
          class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] text-[#cccccc] hover:text-white rounded-lg text-xs font-medium transition-colors border border-[#262626] cursor-pointer"
        >
          ${d("refresh","w-3.5 h-3.5 text-[#8c8c8c]")}
          <span class="hidden md:inline">Reload Snapshot</span>
        </button>

        <!-- User Menu Popover Trigger -->
        <div class="relative">
          <button
            id="user-menu-btn"
            type="button"
            aria-label="User menu"
            class="size-8 rounded-lg text-[#8c8c8c] hover:text-white hover:bg-[#161616] flex items-center justify-center transition-colors cursor-pointer"
          >
            ${d("user","w-4 h-4")}
          </button>

          <!-- Popover Dropdown Menu -->
          <div
            id="user-popover-menu"
            class="hidden absolute right-0 top-full mt-2 w-[260px] bg-[#0e0e0e] border border-[#262626] rounded-[8px] shadow-2xl p-1.5 z-50 select-none animate-in fade-in zoom-in-95 font-sans"
          >
            <!-- Account info header -->
            <div class="p-2.5 rounded-lg bg-[#141414] border border-[#1f1f1f] mb-1">
              <div class="flex items-center justify-between gap-1">
                <span class="text-[14px] font-medium text-white truncate leading-tight">
                  ${t}
                </span>
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-[#8c8c8c] bg-[#1a1a1a] border border-[#262626] capitalize shrink-0">
                  Admin
                </span>
              </div>
              <p class="text-[12px] text-[#8c8c8c] truncate leading-tight mt-1 font-mono">
                ${t}@localhost
              </p>
            </div>

            <!-- Navigation Items -->
            <div class="space-y-0.5 py-0.5">
              <a
                href="#/system"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${d("settings","w-4 h-4 text-[#8c8c8c]")}
                <span>System Settings</span>
              </a>

              <a
                href="#/audit"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${d("file-text","w-4 h-4 text-[#8c8c8c]")}
                <span>Audit Logs</span>
              </a>

              <a
                href="#/metrics"
                class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-white hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer"
              >
                ${d("activity","w-4 h-4 text-[#8c8c8c]")}
                <span>Gateway Metrics</span>
              </a>
            </div>

            <!-- Edge-to-edge line through padding -->
            <div class="-mx-1.5 h-px bg-[#222222] my-1.5"></div>

            <!-- Sign out button -->
            <button
              id="popover-logout-btn"
              type="button"
              class="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-normal text-[#d4d4d4] hover:text-rose-400 hover:bg-[#1a1a1a] rounded-lg transition-colors cursor-pointer text-left"
            >
              ${d("logout","w-4 h-4 text-[#8c8c8c]")}
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  `}const F=[{title:"Data Plane",items:[{id:"overview",label:"Overview",iconName:"dashboard",hash:"#/overview"},{id:"databases",label:"Databases",iconName:"database",hash:"#/databases"},{id:"cache",label:"Cache Engine",iconName:"hard-drive",hash:"#/cache"}]},{title:"Access & Security",items:[{id:"keys",label:"API Keys",iconName:"key",hash:"#/keys"},{id:"roles",label:"Roles & RBAC",iconName:"shield",hash:"#/roles"},{id:"audit",label:"Audit Trail",iconName:"file-text",hash:"#/audit"}]},{title:"System & Telemetry",items:[{id:"metrics",label:"Metrics",iconName:"activity",hash:"#/metrics"},{id:"logs",label:"Live Logs",iconName:"file-text",hash:"#/logs"},{id:"system",label:"System",iconName:"server",hash:"#/system"}]}];function D(m,t,e){setTimeout(()=>{document.getElementById("sidebar-backdrop")?.addEventListener("click",e),document.getElementById("sidebar-quick-search-btn")?.addEventListener("click",()=>{window.dispatchEvent(new CustomEvent("open-global-search"))})},0);const a=F.map(s=>{const n=s.items.map(i=>{const p=m===i.id;return`
        <li class="relative">
          <a
            href="${i.hash}"
            class="group/menu-button relative flex w-full min-w-0 cursor-pointer items-center rounded-lg outline-none min-h-[34px] py-0 text-sm font-medium transition-colors duration-150 gap-2.5 px-3 ${p?"bg-[#111111] text-white border-l-2 border-[#f38020]":"text-[#d4d4d4] hover:bg-[#161616] hover:text-white border-l-2 border-transparent"}"
          >
            <span class="${p?"text-[#f38020]":"text-[#8c8c8c]"} opacity-75 group-hover/menu-button:opacity-100">
              ${d(i.iconName,"w-4 h-4")}
            </span>
            <span class="truncate text-[13px]">${i.label}</span>
            ${i.badge?`<span class="ml-auto inline-flex items-center rounded-full border border-dashed border-[#383838] px-1.5 py-0.5 text-[11px] font-medium text-[#d4d4d4] select-none">${i.badge}</span>`:""}
          </a>
        </li>
      `}).join("");return`
      <div class="flex min-w-0 flex-col gap-y-px">
        <div class="mt-4 mb-2 truncate px-3 text-xs font-medium uppercase tracking-wider text-[#8c8c8c]">
          ${s.title}
        </div>
        <ul class="m-0 flex min-w-0 list-none flex-col items-stretch gap-y-px p-0">
          ${n}
        </ul>
      </div>
    `}).join("");return`
    <!-- Mobile Backdrop -->
    <div
      id="sidebar-backdrop"
      class="fixed inset-0 z-40 bg-black/80 backdrop-blur-xs md:hidden ${t?"block":"hidden"} animate-in fade-in duration-200"
    ></div>

    <!-- Main Sidebar Shell -->
    <aside
      class="flex min-h-screen shrink-0 flex-col bg-[#000000] border-r border-[#222222] w-[260px] fixed md:sticky top-0 h-screen select-none z-40 transition-transform duration-200 ${t?"translate-x-0":"-translate-x-full md:translate-x-0"}"
    >
      <!-- Top Header: Logo, Name and Version Badge -->
      <div class="flex h-[58px] shrink-0 items-center justify-between border-b border-[#222222] px-4 select-none relative z-30">
        <a href="#/overview" class="flex items-center gap-2.5 bg-transparent border-0 p-0 cursor-pointer min-w-0 group">
          <div class="size-6 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs transition-transform group-hover:scale-105">
            AX
          </div>
          <span class="text-[16px] text-[#F2F3F3] font-semibold tracking-wide truncate">
            Axiom
          </span>
          <span class="inline-flex items-center px-1.5 py-0.5 rounded-[4px] bg-[#161718] border border-[#26282A] text-[11px] font-mono text-[#A1A1A1] tracking-normal">
            v4.0.0
          </span>
        </a>

        <!-- Mobile close button -->
        <button
          id="sidebar-close-btn"
          class="p-1 text-[#8c8c8c] hover:text-white md:hidden shrink-0 cursor-pointer"
          aria-label="Close sidebar"
        >
          ${d("x","w-5 h-5")}
        </button>
      </div>

      <!-- Navigation Viewport & Scroll Area -->
      <nav class="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden px-[11px] py-3 scrollbar-thin scrollbar-thumb-[#222222]">
        <!-- Quick Search Bar (Ctrl+K) -->
        <div class="w-full shrink-0 px-0.5 mb-2">
          <button
            id="sidebar-quick-search-btn"
            type="button"
            class="group items-center select-none border-0 rounded-lg bg-[#0c0c0c] text-[#d4d4d4] ring-1 ring-[#262626] hover:ring-[#3b82f6] flex h-8 text-xs font-normal shrink-0 w-full overflow-hidden px-3 gap-2.5 transition-all cursor-pointer text-left"
          >
            ${d("search","w-3.5 h-3.5 text-[#8c8c8c] shrink-0 opacity-60")}
            <span class="text-xs text-[#8c8c8c] font-normal flex-1">Quick search...</span>
            <kbd class="ml-auto font-sans text-[11px] font-semibold text-[#d4d4d4] whitespace-nowrap select-none pointer-events-none shrink-0">
              <span class="text-[#8c8c8c] font-medium">Ctrl</span>&nbsp;K
            </kbd>
          </button>
        </div>

        <!-- Sections Menu -->
        ${a}
      </nav>

      <!-- Footer -->
      <div class="flex h-12 min-h-[48px] shrink-0 items-center justify-between border-t border-[#222222] bg-[#000000] px-4 sticky bottom-0 z-20 text-xs text-[#8c8c8c]">
        <div class="flex items-center gap-2">
          <span class="size-2 rounded-full bg-emerald-400"></span>
          <span class="font-mono text-[11px]">Control Plane</span>
        </div>
        <a href="#/system" class="text-[#8c8c8c] hover:text-white transition-colors text-[11px]">
          Docs & API
        </a>
      </div>
    </aside>
  `}const A=[{id:"overview",label:"Overview Dashboard",category:"Data Plane",hash:"#/overview",iconName:"dashboard"},{id:"databases",label:"Databases & Connections",category:"Data Plane",hash:"#/databases",iconName:"database"},{id:"cache",label:"Cache Engine Telemetry",category:"Data Plane",hash:"#/cache",iconName:"hard-drive"},{id:"keys",label:"API Keys & Secrets",category:"Access & Security",hash:"#/keys",iconName:"key"},{id:"roles",label:"Roles & RBAC Policies",category:"Access & Security",hash:"#/roles",iconName:"shield"},{id:"audit",label:"Audit Trail Logs",category:"Access & Security",hash:"#/audit",iconName:"file-text"},{id:"metrics",label:"Prometheus Metrics",category:"Observability",hash:"#/metrics",iconName:"activity"},{id:"logs",label:"Live Server Logs",category:"Observability",hash:"#/logs",iconName:"file-text"},{id:"system",label:"System Diagnostics & Info",category:"System",hash:"#/system",iconName:"server"}];function K(){let m=!1,t="",e=0;const a=()=>{let o=document.getElementById("global-search-modal");return o||(o=document.createElement("div"),o.id="global-search-modal",o.className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs hidden flex items-start justify-center pt-24 px-4 select-none",document.body.appendChild(o)),o},s=()=>{const o=t.trim().toLowerCase();return o?A.filter(x=>x.label.toLowerCase().includes(o)||x.category.toLowerCase().includes(o)):A},n=()=>{const o=a();if(!m){o.classList.add("hidden");return}o.classList.remove("hidden");const x=s();e>=x.length&&(e=Math.max(0,x.length-1)),o.innerHTML=`
      <div id="search-modal-card" class="bg-[#0c0c0c] border border-[#262626] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95">
        <!-- Input Header -->
        <div class="flex items-center px-4 border-b border-[#222222] bg-[#000000] h-12">
          ${d("search","w-4 h-4 text-[#8c8c8c] mr-3")}
          <input
            id="global-search-input"
            type="text"
            placeholder="Type a command or jump to page..."
            value="${t}"
            autocomplete="off"
            spellcheck="false"
            class="w-full bg-transparent text-[14px] text-white placeholder-[#666666] outline-none border-0"
          />
          <kbd class="ml-2 px-1.5 py-0.5 text-[11px] font-mono text-[#8c8c8c] bg-[#161616] border border-[#262626] rounded">ESC</kbd>
        </div>

        <!-- Results List -->
        <div class="max-h-72 overflow-y-auto p-1.5 space-y-0.5">
          ${x.length===0?'<div class="py-8 text-center text-xs text-[#666666]">No matching navigation routes found.</div>':x.map((u,b)=>{const c=b===e;return`
              <div 
                data-index="${b}"
                class="search-result-item flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${c?"bg-[#1a1a1a] text-white":"text-[#8c8c8c] hover:bg-[#141414] hover:text-white"}"
              >
                <div class="flex items-center gap-2.5">
                  <span class="${c?"text-[#f38020]":"text-[#8c8c8c]"}">
                    ${d(u.iconName,"w-4 h-4")}
                  </span>
                  <span class="text-xs font-medium">${u.label}</span>
                </div>
                <span class="text-[11px] text-[#666666] font-mono uppercase">${u.category}</span>
              </div>
            `}).join("")}
        </div>

        <!-- Footer -->
        <div class="px-4 py-2 border-t border-[#222222] bg-[#0a0a0a] flex items-center justify-between text-[11px] text-[#666666]">
          <div class="flex items-center gap-3">
            <span><kbd class="font-mono text-[#8c8c8c]">↑↓</kbd> navigate</span>
            <span><kbd class="font-mono text-[#8c8c8c]">↵</kbd> select</span>
          </div>
          <span>Axiom Console</span>
        </div>
      </div>
    `;const f=document.getElementById("global-search-input");f&&(f.focus(),f.setSelectionRange(f.value.length,f.value.length),f.addEventListener("input",u=>{t=u.target.value,e=0,n()})),o.querySelectorAll(".search-result-item").forEach(u=>{u.addEventListener("click",()=>{const b=parseInt(u.getAttribute("data-index")||"0",10),c=x[b];c&&(p(),window.location.hash=c.hash)})})},i=()=>{m=!0,t="",e=0,n()},p=()=>{m=!1,n()};window.addEventListener("keydown",o=>{if((o.ctrlKey||o.metaKey)&&o.key.toLowerCase()==="k")o.preventDefault(),m?p():i();else if(m){if(o.key==="Escape")o.preventDefault(),p();else if(o.key==="ArrowDown"){o.preventDefault();const x=s();x.length>0&&(e=(e+1)%x.length,n())}else if(o.key==="ArrowUp"){o.preventDefault();const x=s();x.length>0&&(e=(e-1+x.length)%x.length,n())}else if(o.key==="Enter"){o.preventDefault();const x=s();if(x[e]){const f=x[e];p(),window.location.hash=f.hash}}}}),window.addEventListener("open-global-search",()=>i()),document.addEventListener("mousedown",o=>{if(!m)return;const x=document.getElementById("global-search-modal"),f=document.getElementById("search-modal-card");x&&f&&o.target===x&&p()})}function U(m){let t=1,e="",a="",s="",n="",i="postgres",p="";function o(){m.innerHTML=`
      <div class="min-h-screen flex items-center justify-center p-4 bg-[#000000] select-none font-sans">
        <div class="w-full max-w-lg bg-[#0e0e0e] border border-[#262626] rounded-xl p-6 sm:p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-95">
          
          <!-- Stepper Indicator -->
          <div class="flex items-center justify-between border-b border-[#222222] pb-4">
            <div class="flex items-center gap-2.5">
              <div class="size-7 rounded-[4px] bg-[#f38020] text-white flex items-center justify-center font-bold text-xs tracking-wider shadow-xs">
                AX
              </div>
              <span class="text-sm font-semibold text-white">Axiom Setup Wizard</span>
            </div>
            <div class="text-xs text-[#8c8c8c] font-mono">
              Step ${t} of 4
            </div>
          </div>

          <div id="setup-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

          ${x()}

        </div>
      </div>
    `,f()}function x(){switch(t){case 1:return`
          <div class="space-y-4 text-xs">
            <h2 class="text-lg font-semibold text-white">Welcome to Axiom Gateway</h2>
            <p class="text-xs text-[#8c8c8c] leading-relaxed">
              Axiom is a high-performance SQL API gateway that unifies connection pooling, 
              RBAC authorization, high-speed L1/L2 caching, and Model Context Protocol (MCP) into a single binary.
            </p>
            <div class="bg-[#141414] border border-[#262626] rounded-lg p-4 space-y-2 text-[#8c8c8c]">
              <div class="flex items-center gap-2 text-white font-medium">
                ${d("shield","w-4 h-4 text-[#f38020]")}
                <span>What we will configure:</span>
              </div>
              <ul class="list-disc pl-5 space-y-1.5 pt-1 text-[#cccccc]">
                <li>Create the primary administrative owner account.</li>
                <li>Connect your first upstream SQL database (PostgreSQL, MySQL, SQLite, MSSQL, ClickHouse).</li>
                <li>Bootstrap the persistent cryptographic metadata store (<code class="text-white font-mono">axiom.db</code>).</li>
              </ul>
            </div>
            <button id="step1-next" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Begin Configuration &rarr;
            </button>
          </div>
        `;case 2:return`
          <form id="step2-form" class="space-y-4 text-xs">
            <div>
              <h2 class="text-lg font-semibold text-white">Create Primary Administrator</h2>
              <p class="text-xs text-[#8c8c8c] mt-0.5">This account owns and manages the Web UI console and operator policies.</p>
            </div>

            <div>
              <label for="admin-user" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Admin Username</label>
              <input 
                id="admin-user" 
                type="text" 
                required 
                placeholder="admin"
                value="${e}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
              />
            </div>

            <div>
              <label for="admin-pass" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Master Password</label>
              <input 
                id="admin-pass" 
                type="password" 
                required 
                minlength="8"
                placeholder="Minimum 8 characters"
                value="${a}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
              />
            </div>

            <button type="submit" id="step2-next" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Continue to Database Setup &rarr;
            </button>
          </form>
        `;case 3:return`
          <form id="step3-form" class="space-y-4 text-xs">
            <div>
              <h2 class="text-lg font-semibold text-white">Connect First Database</h2>
              <p class="text-xs text-[#8c8c8c] mt-0.5">Register an upstream SQL database pool. You can also skip this and add databases later.</p>
            </div>

            <div>
              <label for="db-alias" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Database Alias</label>
              <input 
                id="db-alias" 
                type="text" 
                placeholder="main_db"
                value="${s}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors font-mono"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="db-engine" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Engine Dialect</label>
                <select 
                  id="db-engine"
                  class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none transition-colors"
                >
                  <option value="postgres" ${i==="postgres"?"selected":""}>PostgreSQL</option>
                  <option value="mysql" ${i==="mysql"?"selected":""}>MySQL / MariaDB</option>
                  <option value="sqlite" ${i==="sqlite"?"selected":""}>SQLite / LibSQL</option>
                  <option value="mssql" ${i==="mssql"?"selected":""}>Microsoft SQL Server</option>
                  <option value="clickhouse" ${i==="clickhouse"?"selected":""}>ClickHouse</option>
                </select>
              </div>
              <div>
                <label for="pool-size" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Max Connections</label>
                <input 
                  id="pool-size" 
                  type="number" 
                  value="10" 
                  class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white font-mono focus:border-[#3b82f6] outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label for="db-url" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Connection URL</label>
              <input 
                id="db-url" 
                type="text" 
                placeholder="postgres://user:pass@localhost:5432/mydb"
                value="${n}"
                class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors font-mono"
              />
            </div>

            <div class="flex gap-2.5 pt-2">
              <button type="button" id="step3-skip" class="flex-1 h-9 bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white text-xs font-medium rounded-lg transition-colors cursor-pointer">
                Skip for Now
              </button>
              <button type="submit" id="step3-next" class="flex-1 h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
                Save & Continue
              </button>
            </div>
          </form>
        `;case 4:return`
          <div class="space-y-4 text-xs">
            <div class="text-center py-4">
              <div class="size-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center mb-3">
                ${d("check","w-6 h-6")}
              </div>
              <h2 class="text-xl font-semibold text-white">Setup Complete!</h2>
              <p class="text-xs text-[#8c8c8c] mt-1">Axiom Gateway is initialized and the wizard is now permanently locked.</p>
            </div>

            <div class="bg-[#141414] border border-[#262626] rounded-lg p-4 space-y-2">
              <div class="text-[#8c8c8c] font-medium">Session Token:</div>
              <div class="flex items-center justify-between bg-[#0e0e0e] p-2.5 rounded border border-[#262626] font-mono text-[11px] text-white overflow-x-auto">
                <span class="truncate">${p||"Active Session Established"}</span>
              </div>
            </div>

            <button id="step4-finish" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors shadow-xs cursor-pointer">
              Launch Gateway Dashboard &rarr;
            </button>
          </div>
        `;default:return""}}function f(){const u=document.getElementById("setup-error");t===1?document.getElementById("step1-next")?.addEventListener("click",()=>{t=2,o()}):t===2?(document.getElementById("admin-user")?.focus(),document.getElementById("step2-form")?.addEventListener("submit",async b=>{b.preventDefault(),e=document.getElementById("admin-user").value.trim(),a=document.getElementById("admin-pass").value;const c=document.getElementById("step2-next");c.disabled=!0,c.textContent="Creating Account...";try{const l=await k.createAdminAccount({username:e,password:a});p=l.token,localStorage.setItem("axiom_session_token",l.token),localStorage.setItem("axiom_username",l.username),v.success("Admin account created"),t=3,o()}catch(l){u.textContent=l instanceof Error?l.message:"Account creation failed",u.classList.remove("hidden"),c.disabled=!1,c.textContent="Continue to Database Setup"}})):t===3?(document.getElementById("db-alias")?.focus(),document.getElementById("step3-skip")?.addEventListener("click",async()=>{try{await k.completeSetup(),v.info("Database setup skipped"),t=4,o()}catch{t=4,o()}}),document.getElementById("step3-form")?.addEventListener("submit",async b=>{if(b.preventDefault(),s=document.getElementById("db-alias").value.trim(),i=document.getElementById("db-engine").value,n=document.getElementById("db-url").value.trim(),s&&n)try{await k.setupDatabase({alias:s,url:n,engine:i}),v.success(`Connected database '${s}'`)}catch(c){u.textContent=c instanceof Error?c.message:"Failed to register database",u.classList.remove("hidden");return}try{await k.completeSetup()}catch{}t=4,o()})):t===4&&document.getElementById("step4-finish")?.addEventListener("click",()=>{window.location.hash="#/overview"})}o()}function G(m){m.innerHTML=`
    <div class="min-h-screen flex items-center justify-center p-4 bg-[#000000] select-none font-sans">
      <div class="w-full max-w-sm bg-[#0e0e0e] border border-[#262626] rounded-xl p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-95">
        <div class="flex items-center gap-3">
          <div class="size-9 rounded-lg bg-[#f38020] flex items-center justify-center font-bold text-white tracking-wider shadow-xs text-sm">
            AX
          </div>
          <div>
            <h1 class="text-base font-semibold text-white tracking-tight">Axiom Gateway</h1>
            <p class="text-xs text-[#8c8c8c]">Administrative Console</p>
          </div>
        </div>

        <div id="login-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="login-form" class="space-y-4 text-xs">
          <div>
            <label for="username" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Username</label>
            <input 
              id="username" 
              name="username" 
              type="text" 
              required 
              autocomplete="username"
              placeholder="admin"
              class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <div>
            <label for="password" class="block text-xs font-medium text-[#8c8c8c] mb-1.5">Password</label>
            <input 
              id="password" 
              name="password" 
              type="password" 
              required 
              autocomplete="current-password"
              placeholder="••••••••••••"
              class="w-full h-9 px-3 text-xs bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            type="submit" 
            id="login-btn"
            class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] active:bg-[#d06810] text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center shadow-xs cursor-pointer mt-2"
          >
            <span>Sign In</span>
          </button>
        </form>

        <div class="pt-2 border-t border-[#222222] text-center text-[11px] text-[#666666] font-mono">
          Engine v4.0.0 • Pure Single-Binary
        </div>
      </div>
    </div>
  `;const t=document.getElementById("login-form"),e=document.getElementById("login-error"),a=document.getElementById("login-btn");document.getElementById("username")?.focus(),t.addEventListener("submit",async s=>{s.preventDefault(),e.classList.add("hidden"),e.textContent="",a.disabled=!0,a.innerHTML="<span>Verifying credentials...</span>";const n=document.getElementById("username").value.trim(),i=document.getElementById("password").value;try{const p=await k.login({username:n,password:i});localStorage.setItem("axiom_session_token",p.token),localStorage.setItem("axiom_username",p.username),v.success(`Welcome back, ${p.username}`),window.location.hash="#/overview"}catch(p){e.textContent=p instanceof Error?p.message:"Invalid credentials",e.classList.remove("hidden")}finally{a.disabled=!1,a.innerHTML="<span>Sign In</span>"}})}async function R(m){m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Page Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Overview</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Real-time gateway status, connection pools, and cache telemetry.</p>
        </div>
        <button 
          id="refresh-overview" 
          type="button"
          class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
        >
          ${d("refresh","w-3.5 h-3.5 text-[#8c8c8c]")}
          <span>Refresh</span>
        </button>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <!-- Databases Card -->
        <a href="#/databases" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Active Databases</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${d("arrow-up-right","w-3.5 h-3.5")}
              <span>Pools</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-dbs" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">configured</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 25 10, 50 16 T 100 4" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- API Keys Card -->
        <a href="#/keys" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Registered API Keys</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              ${d("key","w-3.5 h-3.5")}
              <span>Tokens</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-keys" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">active</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 18 Q 30 5, 60 14 T 100 6" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- Cache Hit Rate Card -->
        <a href="#/cache" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">Cache Hit Ratio</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${d("arrow-up-right","w-3.5 h-3.5")}
              <span>L1+L2</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-cache-rate" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span id="stat-cache-entries" class="text-xs text-[#8c8c8c]">0 entries</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 22 Q 25 12, 50 15 T 100 2" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </a>

        <!-- Uptime & Diagnostics Card -->
        <a href="#/system" class="block rounded-lg bg-[#0e0e0e] border border-[#222222] hover:border-[#383838] transition-colors p-4 relative group overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal group-hover:text-[#cccccc] transition-colors">System Uptime</span>
            <span class="text-xs font-medium text-purple-400 flex items-center gap-0.5">
              ${d("activity","w-3.5 h-3.5")}
              <span>Healthy</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="stat-uptime" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span id="stat-mem" class="text-xs text-[#8c8c8c]">RSS: — MB</span>
          </div>
          <div class="w-full h-10 mt-3 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 30 8, 70 12 T 100 5" fill="none" stroke="#a855f7" stroke-width="2" />
            </svg>
          </div>
        </a>
      </div>

      <!-- Quick Actions & Recent Activity -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Quick Actions Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-white">Management Actions</h2>
            <span class="text-[11px] text-[#666666] font-mono">v4.0</span>
          </div>
          <div class="space-y-2">
            <a href="#/databases" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">${d("database","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Connect Database</div>
                  <div class="text-[11px] text-[#8c8c8c]">PostgreSQL, MySQL, SQLite, MSSQL</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>

            <a href="#/keys" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-[#f38020]/10 text-[#f38020]">${d("key","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Issue API Key</div>
                  <div class="text-[11px] text-[#8c8c8c]">Generate credential with role grants</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>

            <a href="#/cache" class="flex items-center justify-between p-3 rounded-lg bg-[#141414] border border-[#262626] hover:border-[#383838] hover:bg-[#1a1a1a] transition-all group">
              <div class="flex items-center gap-3">
                <span class="p-2 rounded-md bg-emerald-500/10 text-emerald-400">${d("hard-drive","w-4 h-4")}</span>
                <div>
                  <div class="text-xs font-medium text-white group-hover:text-[#f38020] transition-colors">Inspect Cache Engine</div>
                  <div class="text-[11px] text-[#8c8c8c]">L1 RAM + L2 SQLite persistence</div>
                </div>
              </div>
              <span class="text-[#666666] group-hover:text-white transition-colors">&rarr;</span>
            </a>
          </div>
        </div>

        <!-- Recent Audit Log Table in DataTable Pattern -->
        <div class="lg:col-span-2 border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col">
          <div class="flex items-center justify-between px-4 py-3 bg-[#141414] border-b border-[#222222]">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-medium text-white">Recent Control Plane Activity</h2>
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-[#1a1a1a] border border-[#262626] text-[#8c8c8c]">Live</span>
            </div>
            <a href="#/audit" class="text-xs text-[#f38020] hover:underline font-medium">View full trail &rarr;</a>
          </div>

          <div class="overflow-x-auto w-full">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-[#222222] bg-[#141414] h-[36px] text-xs text-[#8c8c8c] font-medium">
                  <th class="px-4">Action</th>
                  <th class="px-4">Target Resource</th>
                  <th class="px-4 hidden sm:table-cell">Details</th>
                  <th class="px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody id="overview-audit-list" class="divide-y divide-[#1e1e1e] text-[13px]">
                <tr>
                  <td colspan="4" class="px-4 py-8 text-center text-xs text-[#666666]">
                    <div class="h-4 w-1/2 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;async function t(){try{const[e,a,s]=await Promise.all([k.getStatus().catch(()=>null),k.getCacheStats().catch(()=>null),k.getAuditLog(6,0).catch(()=>[])]);if(e){document.getElementById("stat-dbs").textContent=String(e.active_databases),document.getElementById("stat-keys").textContent=String(e.registered_keys);const i=Math.floor(e.uptime_seconds/60),p=i<60?`${i}m`:`${Math.floor(i/60)}h ${i%60}m`;document.getElementById("stat-uptime").textContent=p,document.getElementById("stat-mem").textContent=`RSS: ${e.memory_mb} MB`}if(a){const i=a.hits_l1+a.hits_l2,p=i+a.misses,o=p>0?(i/p*100).toFixed(1):"0.0";document.getElementById("stat-cache-rate").textContent=`${o}%`,document.getElementById("stat-cache-entries").textContent=`${a.entries_count} L1 items`}const n=document.getElementById("overview-audit-list");s&&s.length>0?n.innerHTML=s.map(i=>`
          <tr class="h-[40px] hover:bg-[#161616] transition-colors">
            <td class="px-4 py-2">
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium uppercase bg-[#161616] text-[#f38020] border border-[#262626]">
                ${i.action}
              </span>
            </td>
            <td class="px-4 py-2 font-mono text-white text-xs">${i.target}</td>
            <td class="px-4 py-2 text-[#8c8c8c] text-xs truncate max-w-xs hidden sm:table-cell">${i.details||"—"}</td>
            <td class="px-4 py-2 text-[#8c8c8c] text-xs font-mono text-right tabular-nums">
              ${new Date(i.timestamp*1e3).toLocaleTimeString()}
            </td>
          </tr>
        `).join(""):n.innerHTML=`
          <tr>
            <td colspan="4" class="px-4 py-8 text-center text-xs text-[#666666]">
              No recent audit log entries recorded.
            </td>
          </tr>
        `}catch{}}document.getElementById("refresh-overview")?.addEventListener("click",async()=>{await t(),v.info("Overview telemetry refreshed")}),t()}async function V(m){let t=[],e="";m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Page Header & Action Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Databases</h1>
            <span id="db-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 pools</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Manage live connection pools, upstream dialects, and health probes.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${d("search","w-3.5 h-3.5 opacity-60")}
            </span>
            <input
              id="db-search-input"
              type="text"
              placeholder="Filter databases..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-add-db-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${d("plus","w-3.5 h-3.5")}
            <span>Connect Database</span>
          </button>
        </div>
      </div>

      <!-- Databases Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Database Alias</th>
                <th class="px-4">Engine Dialect</th>
                <th class="px-4">Pool Bounds</th>
                <th class="px-4">Registered Date</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="db-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="db-footer-status">Showing databases</span>
          <span class="font-mono text-[11px] text-[#666666]">DashMap Pool Registry</span>
        </div>
      </div>
    </div>

    <!-- Connect Database Modal matching Dialog.tsx in binary_alive -->
    <div id="add-db-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${d("database","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Connect Upstream Database</h2>
          </div>
          <button id="close-add-db-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${d("x","w-4 h-4")}
          </button>
        </div>

        <div id="modal-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="add-db-form" class="space-y-4 text-xs">
          <div>
            <label for="new-db-alias" class="block text-[#8c8c8c] mb-1 font-medium">Database Alias</label>
            <input 
              id="new-db-alias" 
              type="text" 
              required 
              placeholder="e.g. analytics_db" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none font-mono text-xs transition-colors" 
            />
          </div>

          <div>
            <label for="new-db-engine" class="block text-[#8c8c8c] mb-1 font-medium">Engine Dialect</label>
            <select 
              id="new-db-engine" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none text-xs transition-colors"
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite / LibSQL</option>
              <option value="mssql">Microsoft SQL Server</option>
              <option value="clickhouse">ClickHouse</option>
            </select>
          </div>

          <div>
            <label for="new-db-url" class="block text-[#8c8c8c] mb-1 font-medium">Connection URL</label>
            <input 
              id="new-db-url" 
              type="text" 
              required 
              placeholder="postgres://user:pass@localhost:5432/dbname" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="new-db-min" class="block text-[#8c8c8c] mb-1 font-medium">Min Connections</label>
              <input 
                id="new-db-min" 
                type="number" 
                value="1" 
                min="1" 
                class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
              />
            </div>
            <div>
              <label for="new-db-max" class="block text-[#8c8c8c] mb-1 font-medium">Max Connections</label>
              <input 
                id="new-db-max" 
                type="number" 
                value="10" 
                min="1" 
                class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
              />
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-add-db" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-add-db" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Connect Pool
            </button>
          </div>
        </form>
      </div>
    </div>
  `;const a=document.getElementById("add-db-modal"),s=document.getElementById("modal-error");function n(u){const b=document.getElementById("db-table-body"),c=document.getElementById("db-count-badge"),l=document.getElementById("db-footer-status");if(c&&(c.textContent=`${t.length} pool${t.length===1?"":"s"}`),u.length===0){b.innerHTML=`
        <tr>
          <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${e?`No databases match "${e}".`:'No databases connected yet. Click "Connect Database" to register your first pool.'}
          </td>
        </tr>
      `,l&&(l.textContent="Showing 0 databases");return}l&&(l.textContent=`Showing ${u.length} of ${t.length} database pool${t.length===1?"":"s"}`),b.innerHTML=u.map(r=>`
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-emerald-400"></span>
            <span>${r.alias}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-[#141414] border border-[#262626] text-[#3b82f6]">
            ${r.engine}
          </span>
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${r.pool_min}..${r.pool_max} conns
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${new Date(r.created_at*1e3).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button 
              data-test-alias="${r.alias}" 
              class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" 
              title="Test database pool connectivity"
            >
              ${d("activity","w-3 h-3 text-[#3b82f6]")}
              <span>Ping</span>
            </button>
            <button 
              data-delete-alias="${r.alias}" 
              class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center cursor-pointer" 
              title="Disconnect database pool"
            >
              ${d("trash","w-3.5 h-3.5")}
            </button>
          </div>
        </td>
      </tr>
    `).join(""),b.querySelectorAll("[data-test-alias]").forEach(r=>{r.addEventListener("click",async h=>{const g=h.currentTarget.getAttribute("data-test-alias");if(!g)return;const w=h.currentTarget;w.disabled=!0,w.innerHTML=`${d("refresh","w-3 h-3 animate-spin")} <span>Pinging...</span>`;try{const y=await k.testDatabase(g);v.success(`Pool '${g}' healthy (dialect: ${y.dialect})`)}catch(y){v.error(y instanceof Error?y.message:`Ping failed for '${g}'`)}finally{w.disabled=!1,w.innerHTML=`${d("activity","w-3 h-3 text-[#3b82f6]")} <span>Ping</span>`}})}),b.querySelectorAll("[data-delete-alias]").forEach(r=>{r.addEventListener("click",h=>{const g=h.currentTarget.getAttribute("data-delete-alias");g&&S({title:"Disconnect Database",message:`Are you sure you want to disconnect database '${g}'? In-flight queries will be closed.`,confirmText:"Disconnect",danger:!0,onConfirm:async()=>{try{await k.deleteDatabase(g),v.success(`Database '${g}' disconnected`),i()}catch(w){v.error(w instanceof Error?w.message:"Failed to disconnect database")}}})})})}async function i(){try{t=await k.getDatabases(),p()}catch{const u=document.getElementById("db-table-body");u.innerHTML='<tr><td colspan="5" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load registered databases.</td></tr>'}}function p(){const u=e.trim().toLowerCase(),b=u?t.filter(c=>c.alias.toLowerCase().includes(u)||c.engine.toLowerCase().includes(u)):t;n(b)}document.getElementById("db-search-input")?.addEventListener("input",u=>{e=u.target.value,p()});const o=()=>a.classList.add("hidden"),x=()=>{s.classList.add("hidden"),a.classList.remove("hidden"),document.getElementById("new-db-alias")?.focus()};document.getElementById("open-add-db-modal")?.addEventListener("click",x),document.getElementById("close-add-db-modal")?.addEventListener("click",o),document.getElementById("cancel-add-db")?.addEventListener("click",o),a.addEventListener("click",u=>{u.target===a&&o()});const f=u=>{u.key==="Escape"&&!a.classList.contains("hidden")&&o()};window.addEventListener("keydown",f),document.getElementById("add-db-form")?.addEventListener("submit",async u=>{u.preventDefault(),s.classList.add("hidden");const b=document.getElementById("new-db-alias").value.trim(),c=document.getElementById("new-db-engine").value,l=document.getElementById("new-db-url").value.trim(),r=parseInt(document.getElementById("new-db-min").value,10)||1,h=parseInt(document.getElementById("new-db-max").value,10)||10,g=document.getElementById("submit-add-db");g.disabled=!0,g.textContent="Connecting...";try{await k.addDatabase({alias:b,engine:c,url:l,pool_min:r,pool_max:h}),v.success(`Database '${b}' connected successfully`),o(),i()}catch(w){s.textContent=w instanceof Error?w.message:"Failed to add database",s.classList.remove("hidden")}finally{g.disabled=!1,g.textContent="Connect Pool"}}),i()}async function W(m){let t=[],e=[],a="";m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header & Actions -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">API Keys</h1>
            <span id="keys-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 keys</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Manage application credentials, rate limits, and cryptographic rotation.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${d("search","w-3.5 h-3.5 opacity-60")}
            </span>
            <input
              id="keys-search-input"
              type="text"
              placeholder="Filter keys..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-create-key-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${d("plus","w-3.5 h-3.5")}
            <span>Create Key</span>
          </button>
        </div>
      </div>

      <!-- Keys Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Key Identifier</th>
                <th class="px-4">Assigned Role</th>
                <th class="px-4">Rate Limit</th>
                <th class="px-4">Expiration</th>
                <th class="px-4">Created</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="keys-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="keys-footer-status">Showing API keys</span>
          <span class="font-mono text-[11px] text-[#666666]">BLAKE3 Hashed</span>
        </div>
      </div>
    </div>

    <!-- Create Key Modal -->
    <div id="create-key-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-md w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${d("key","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Generate Client API Key</h2>
          </div>
          <button id="close-create-key-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${d("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-key-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-key-form" class="space-y-4 text-xs">
          <div>
            <label for="key-name-input" class="block text-[#8c8c8c] mb-1 font-medium">Key Identifier</label>
            <input 
              id="key-name-input" 
              type="text" 
              required 
              placeholder="e.g. backend-microservice" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="key-role-select" class="block text-[#8c8c8c] mb-1 font-medium">RBAC Role Grant</label>
            <select 
              id="key-role-select" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white focus:border-[#3b82f6] outline-none text-xs transition-colors"
            >
              <option value="">No Role (Unrestricted Superadmin)</option>
            </select>
          </div>

          <div>
            <label for="key-rate-input" class="block text-[#8c8c8c] mb-1 font-medium">Rate Limit Override (req/min, 0 = global default)</label>
            <input 
              id="key-rate-input" 
              type="number" 
              value="0" 
              min="0" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="key-secret-input" class="block text-[#8c8c8c] mb-1 font-medium">Custom Secret (optional, auto-generated if blank)</label>
            <input 
              id="key-secret-input" 
              type="password" 
              placeholder="Leave empty for high-entropy BLAKE3 secret" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white placeholder-[#666666] font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-create-key" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-create-key" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Generate Key
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Secret Disclosure Modal -->
    <div id="secret-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center gap-2.5 text-[#f38020] pb-2 border-b border-[#222222]">
          ${d("shield","w-5 h-5")}
          <h2 class="text-sm font-semibold text-white">Save API Key Credentials</h2>
        </div>
        <p class="text-xs text-[#8c8c8c] leading-relaxed">
          This is the <span class="text-amber-400 font-semibold">ONLY time</span> the key secret will be displayed. Axiom stores only irreversible BLAKE3 hashes.
        </p>

        <div class="space-y-3.5">
          <div>
            <label class="block text-[11px] text-[#8c8c8c] font-medium mb-1">X-Axiom-Key Header Value (Base64)</label>
            <div class="flex items-center gap-2 bg-[#141414] border border-[#262626] rounded-lg p-2">
              <input id="secret-token-display" readonly class="w-full bg-transparent text-white text-xs font-mono focus:outline-none" />
              <button id="copy-token-btn" class="h-7 px-2.5 rounded bg-[#1f1f1f] hover:bg-[#282828] text-xs text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" title="Copy to clipboard">
                ${d("copy","w-3.5 h-3.5")}
                <span id="copy-btn-text">Copy</span>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-[11px] text-[#8c8c8c] font-medium mb-1">Example cURL Query</label>
            <div class="bg-[#0a0a0b] border border-[#222222] rounded-lg p-3 font-mono text-xs text-[#cccccc] overflow-x-auto">
              <pre id="secret-curl-display" class="whitespace-pre-wrap"></pre>
            </div>
          </div>
        </div>

        <button id="close-secret-modal" class="w-full h-9 bg-[#f38020] hover:bg-[#e07018] text-white text-xs font-medium rounded-lg transition-colors cursor-pointer shadow-xs">
          I Have Saved This Key
        </button>
      </div>
    </div>
  `;const s=document.getElementById("create-key-modal"),n=document.getElementById("secret-modal"),i=document.getElementById("create-key-error");async function p(){try{e=await k.getRoles();const r=document.getElementById("key-role-select");r&&(r.innerHTML='<option value="">No Role (Unrestricted Superadmin)</option>'+e.map(h=>`<option value="${h.name}">${h.name} (${h.permissions.length} perms)</option>`).join(""))}catch{}}function o(r){document.getElementById("secret-token-display").value=r,document.getElementById("secret-curl-display").textContent=`curl -X POST http://localhost:4500/api/v1/db/main_db/query \\
  -H "X-Axiom-Key: ${r}" \\
  -H "Content-Type: application/json" \\
  -d '{"sql": "SELECT 1;"}'`,n.classList.remove("hidden")}function x(r){const h=document.getElementById("keys-table-body"),g=document.getElementById("keys-count-badge"),w=document.getElementById("keys-footer-status");if(g&&(g.textContent=`${t.length} key${t.length===1?"":"s"}`),r.length===0){h.innerHTML=`
        <tr>
          <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${a?`No keys match "${a}".`:'No API keys registered yet. Click "Create Key" to generate one.'}
          </td>
        </tr>
      `,w&&(w.textContent="Showing 0 keys");return}w&&(w.textContent=`Showing ${r.length} of ${t.length} key${t.length===1?"":"s"}`),h.innerHTML=r.map(y=>`
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            ${d("key","w-3.5 h-3.5 text-[#f38020]")}
            <span>${y.name}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          ${y.role_name?`<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] text-[#f38020] border border-[#262626]">${y.role_name}</span>`:'<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-[#141414] text-[#8c8c8c] border border-[#262626]">superadmin</span>'}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${y.rate_limit>0?`${y.rate_limit} req/min`:'<span class="text-[#666666]">global</span>'}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${y.expires_at?new Date(y.expires_at*1e3).toLocaleDateString():'<span class="text-[#666666]">never</span>'}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c]">
          ${new Date(y.created_at*1e3).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <div class="inline-flex items-center gap-1.5 justify-end">
            <button 
              data-rotate-key="${y.name}" 
              class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors flex items-center gap-1 cursor-pointer" 
              title="Rotate secret"
            >
              ${d("refresh","w-3 h-3 text-[#f38020]")}
              <span>Rotate</span>
            </button>
            <button 
              data-delete-key="${y.name}" 
              class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors flex items-center justify-center cursor-pointer" 
              title="Revoke key"
            >
              ${d("trash","w-3.5 h-3.5")}
            </button>
          </div>
        </td>
      </tr>
    `).join(""),h.querySelectorAll("[data-rotate-key]").forEach(y=>{y.addEventListener("click",L=>{const E=L.currentTarget.getAttribute("data-rotate-key");E&&S({title:`Rotate Secret for '${E}'`,message:"Rotating the secret invalidates the existing token immediately. External applications using the current token will receive 401 Unauthorized until updated.",confirmText:"Rotate Secret",danger:!0,onConfirm:async()=>{try{const $=await k.rotateKey(E);v.success(`Key '${E}' secret rotated successfully`),o($.token)}catch($){v.error($ instanceof Error?$.message:"Rotation failed")}}})})}),h.querySelectorAll("[data-delete-key]").forEach(y=>{y.addEventListener("click",L=>{const E=L.currentTarget.getAttribute("data-delete-key");E&&S({title:`Revoke API Key '${E}'`,message:`Are you sure you want to permanently revoke API key '${E}'? This cannot be undone.`,confirmText:"Revoke Key",danger:!0,onConfirm:async()=>{try{await k.deleteKey(E),v.success(`API key '${E}' revoked`),f()}catch($){v.error($ instanceof Error?$.message:"Failed to revoke key")}}})})})}async function f(){try{t=await k.getKeys(),u()}catch{const r=document.getElementById("keys-table-body");r.innerHTML='<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load API keys.</td></tr>'}}function u(){const r=a.trim().toLowerCase(),h=r?t.filter(g=>g.name.toLowerCase().includes(r)):t;x(h)}document.getElementById("keys-search-input")?.addEventListener("input",r=>{a=r.target.value,u()});const b=()=>{i.classList.add("hidden"),s.classList.remove("hidden"),document.getElementById("key-name-input")?.focus()},c=()=>s.classList.add("hidden"),l=()=>n.classList.add("hidden");document.getElementById("open-create-key-modal")?.addEventListener("click",b),document.getElementById("close-create-key-modal")?.addEventListener("click",c),document.getElementById("cancel-create-key")?.addEventListener("click",c),document.getElementById("close-secret-modal")?.addEventListener("click",l),s.addEventListener("click",r=>{r.target===s&&c()}),n.addEventListener("click",r=>{r.target===n&&l()}),document.getElementById("copy-token-btn")?.addEventListener("click",async()=>{const r=document.getElementById("secret-token-display"),h=document.getElementById("copy-btn-text");try{await navigator.clipboard.writeText(r.value),v.success("API key copied to clipboard"),h&&(h.textContent="Copied!"),setTimeout(()=>{h&&(h.textContent="Copy")},2e3)}catch{r.select(),document.execCommand("copy"),v.info("Copied via fallback")}}),document.getElementById("create-key-form")?.addEventListener("submit",async r=>{r.preventDefault(),i.classList.add("hidden");const h=document.getElementById("key-name-input").value.trim(),g=document.getElementById("key-role-select").value||null,w=parseInt(document.getElementById("key-rate-input").value,10)||0,y=document.getElementById("key-secret-input").value||void 0,L=document.getElementById("submit-create-key");L.disabled=!0,L.textContent="Generating...";try{const E=await k.createKey({name:h,role:g||void 0,rate_limit:w,secret:y});v.success(`Key '${h}' created`),c(),f(),o(E.token_header)}catch(E){i.textContent=E instanceof Error?E.message:"Failed to create key",i.classList.remove("hidden")}finally{L.disabled=!1,L.textContent="Generate Key"}}),await p(),await f()}async function J(m){let t=[],e=[],a="";m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header & Action Controls -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Roles & RBAC</h1>
            <span id="roles-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 roles</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Define access control policies and granular SQL operation permissions.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-48 sm:w-64">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${d("search","w-3.5 h-3.5 opacity-60")}
            </span>
            <input
              id="roles-search-input"
              type="text"
              placeholder="Filter roles..."
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="open-create-role-modal" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#f38020] hover:bg-[#e07018] text-white rounded-lg text-xs font-medium transition-colors shadow-xs cursor-pointer shrink-0"
          >
            ${d("plus","w-3.5 h-3.5")}
            <span>Create Role</span>
          </button>
        </div>
      </div>

      <!-- Roles Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[700px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Role Identifier</th>
                <th class="px-4">Description</th>
                <th class="px-4">Permission Rules</th>
                <th class="px-4">Created Date</th>
                <th class="px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="roles-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Table Footer -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[12px] text-[#8c8c8c]">
          <span id="roles-footer-status">Showing roles</span>
          <span class="font-mono text-[11px] text-[#666666]">ArcSwap Policy Engine</span>
        </div>
      </div>
    </div>

    <!-- Create Role Modal -->
    <div id="create-role-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${d("shield","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Create Access Role</h2>
          </div>
          <button id="close-create-role-modal" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${d("x","w-4 h-4")}
          </button>
        </div>

        <div id="create-role-error" class="hidden p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400"></div>

        <form id="create-role-form" class="space-y-4 text-xs">
          <div>
            <label for="role-name-input" class="block text-[#8c8c8c] mb-1 font-medium">Role Identifier</label>
            <input 
              id="role-name-input" 
              type="text" 
              required 
              placeholder="e.g. read_only_analyst" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white font-mono text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <div>
            <label for="role-desc-input" class="block text-[#8c8c8c] mb-1 font-medium">Description</label>
            <input 
              id="role-desc-input" 
              type="text" 
              placeholder="e.g. Read-only access to customer analytics" 
              class="w-full h-9 px-3 bg-[#141414] border border-[#262626] rounded-lg text-white text-xs focus:border-[#3b82f6] outline-none transition-colors" 
            />
          </div>

          <!-- Permission Rule Builder matching binary_alive PermissionTable -->
          <div class="border border-[#262626] rounded-lg p-4 bg-[#141414] space-y-3.5">
            <div class="font-medium text-white text-xs flex items-center justify-between">
              <span>Rule Builder</span>
              <span class="text-[11px] text-[#8c8c8c] font-mono">Wildcard * supported</span>
            </div>
            
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="perm-db-input" class="block text-[#8c8c8c] text-[11px] mb-1 font-medium">Database Target</label>
                <input id="perm-db-input" type="text" value="*" class="w-full h-8 px-2.5 bg-[#0e0e0e] border border-[#262626] rounded text-white font-mono text-xs focus:outline-none focus:border-[#3b82f6]" />
              </div>
              <div>
                <label for="perm-table-input" class="block text-[#8c8c8c] text-[11px] mb-1 font-medium">Table Target</label>
                <input id="perm-table-input" type="text" value="*" class="w-full h-8 px-2.5 bg-[#0e0e0e] border border-[#262626] rounded text-white font-mono text-xs focus:outline-none focus:border-[#3b82f6]" />
              </div>
            </div>

            <div>
              <label class="block text-[#8c8c8c] text-[11px] mb-2 font-medium">Permitted Operations</label>
              <div class="flex items-center gap-4 font-mono">
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-select" checked class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">SELECT</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-insert" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">INSERT</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-update" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">UPDATE</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer text-[#cccccc] hover:text-white">
                  <input type="checkbox" id="op-delete" class="rounded border-[#262626] bg-[#0e0e0e] text-[#f38020] focus:ring-0" />
                  <span class="text-[11px]">DELETE</span>
                </label>
              </div>
            </div>

            <button type="button" id="add-perm-rule-btn" class="w-full h-8 bg-[#1f1f1f] hover:bg-[#282828] text-white border border-[#262626] rounded-lg text-xs font-medium transition-colors cursor-pointer">
              + Append Rule to Role
            </button>

            <!-- Pending Rules List -->
            <div id="pending-rules-container" class="space-y-1.5 pt-2 border-t border-[#222222]">
              <div class="text-[11px] text-[#8c8c8c]">No rules appended yet. Minimum 1 rule required.</div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-3 border-t border-[#222222]">
            <button type="button" id="cancel-create-role" class="h-8 px-3 rounded-lg bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-[#cccccc] hover:text-white font-medium transition-colors cursor-pointer">
              Cancel
            </button>
            <button type="submit" id="submit-create-role" class="h-8 px-3.5 rounded-lg bg-[#f38020] hover:bg-[#e07018] text-white font-medium transition-colors shadow-xs cursor-pointer">
              Save Role
            </button>
          </div>
        </form>
      </div>
    </div>
  `;const s=document.getElementById("create-role-modal"),n=document.getElementById("create-role-error");function i(){const c=document.getElementById("pending-rules-container");if(t.length===0){c.innerHTML='<div class="text-[11px] text-[#8c8c8c]">No rules appended yet. Minimum 1 rule required.</div>';return}c.innerHTML=t.map((l,r)=>`
      <div class="flex items-center justify-between p-2 rounded bg-[#0e0e0e] border border-[#262626] text-[11px] font-mono">
        <div>
          <span class="text-[#3b82f6]">${l.database}</span>.<span class="text-white">${l.table_name}</span> &rarr;
          <span class="text-[#f38020] font-semibold">[${l.operations.join(", ")}]</span>
        </div>
        <button type="button" data-remove-rule="${r}" class="text-[#8c8c8c] hover:text-rose-400 p-0.5 cursor-pointer" title="Remove rule">
          ${d("x","w-3.5 h-3.5")}
        </button>
      </div>
    `).join(""),c.querySelectorAll("[data-remove-rule]").forEach(l=>{l.addEventListener("click",r=>{const h=parseInt(r.currentTarget.getAttribute("data-remove-rule")||"0",10);t.splice(h,1),i()})})}function p(c){const l=document.getElementById("roles-table-body"),r=document.getElementById("roles-count-badge"),h=document.getElementById("roles-footer-status");if(r&&(r.textContent=`${e.length} role${e.length===1?"":"s"}`),c.length===0){l.innerHTML=`
        <tr>
          <td colspan="5" class="px-4 py-12 text-center text-xs text-[#666666]">
            ${a?`No roles match "${a}".`:'No custom roles created yet. Click "Create Role" to establish policies.'}
          </td>
        </tr>
      `,h&&(h.textContent="Showing 0 roles");return}h&&(h.textContent=`Showing ${c.length} of ${e.length} role${e.length===1?"":"s"}`),l.innerHTML=c.map(g=>`
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono font-medium text-white text-xs">
          <div class="flex items-center gap-2">
            ${d("shield","w-3.5 h-3.5 text-[#f38020]")}
            <span>${g.name}</span>
          </div>
        </td>
        <td class="px-4 py-2 text-xs text-[#8c8c8c]">${g.description||"—"}</td>
        <td class="px-4 py-2">
          <div class="flex flex-wrap gap-1 font-mono text-[11px]">
            ${g.permissions.map(w=>`
              <span class="inline-flex items-center px-1.5 py-0.5 rounded bg-[#141414] border border-[#262626] text-white">
                <span class="text-[#3b82f6]">${w.database}</span>.<span class="text-white">${w.table_name}</span>: <span class="text-[#f38020] font-medium ml-1">${w.operations.join(",")}</span>
              </span>
            `).join("")}
          </div>
        </td>
        <td class="px-4 py-2 text-xs text-[#8c8c8c] font-mono">
          ${new Date(g.created_at*1e3).toLocaleDateString()}
        </td>
        <td class="px-4 py-2 text-right">
          <button 
            data-delete-role="${g.name}" 
            class="size-7 rounded bg-[#141414] hover:bg-rose-500/20 border border-[#262626] hover:border-rose-500/30 text-[#8c8c8c] hover:text-rose-400 transition-colors inline-flex items-center justify-center cursor-pointer" 
            title="Delete role"
          >
            ${d("trash","w-3.5 h-3.5")}
          </button>
        </td>
      </tr>
    `).join(""),l.querySelectorAll("[data-delete-role]").forEach(g=>{g.addEventListener("click",w=>{const y=w.currentTarget.getAttribute("data-delete-role");y&&S({title:`Delete Role '${y}'`,message:`Deleting role '${y}' will remove associated permission rules. API keys assigned to this role will lose their scoped capabilities.`,confirmText:"Delete Role",danger:!0,onConfirm:async()=>{try{await k.deleteRole(y),v.success(`Role '${y}' deleted`),o()}catch(L){v.error(L instanceof Error?L.message:"Failed to delete role")}}})})})}async function o(){try{e=await k.getRoles(),x()}catch{const c=document.getElementById("roles-table-body");c.innerHTML='<tr><td colspan="5" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load roles.</td></tr>'}}function x(){const c=a.trim().toLowerCase(),l=c?e.filter(r=>r.name.toLowerCase().includes(c)||r.description&&r.description.toLowerCase().includes(c)):e;p(l)}document.getElementById("roles-search-input")?.addEventListener("input",c=>{a=c.target.value,x()});const f=()=>s.classList.add("hidden"),u=()=>{t=[],i(),n.classList.add("hidden"),s.classList.remove("hidden"),document.getElementById("role-name-input")?.focus()};document.getElementById("open-create-role-modal")?.addEventListener("click",u),document.getElementById("close-create-role-modal")?.addEventListener("click",f),document.getElementById("cancel-create-role")?.addEventListener("click",f),s.addEventListener("click",c=>{c.target===s&&f()});const b=c=>{c.key==="Escape"&&!s.classList.contains("hidden")&&f()};window.addEventListener("keydown",b),document.getElementById("add-perm-rule-btn")?.addEventListener("click",()=>{const c=document.getElementById("perm-db-input").value.trim()||"*",l=document.getElementById("perm-table-input").value.trim()||"*",r=[];if(document.getElementById("op-select").checked&&r.push("SELECT"),document.getElementById("op-insert").checked&&r.push("INSERT"),document.getElementById("op-update").checked&&r.push("UPDATE"),document.getElementById("op-delete").checked&&r.push("DELETE"),r.length===0){v.error("Select at least one SQL operation for this rule");return}t.push({database:c,table_name:l,operations:r}),i()}),document.getElementById("create-role-form")?.addEventListener("submit",async c=>{c.preventDefault(),n.classList.add("hidden");const l=document.getElementById("role-name-input").value.trim(),r=document.getElementById("role-desc-input").value.trim();if(t.length===0){n.textContent="Please append at least one permission rule to this role",n.classList.remove("hidden");return}const h=document.getElementById("submit-create-role");h.disabled=!0,h.textContent="Saving...";try{await k.createRole({name:l,description:r,permissions:t}),v.success(`Role '${l}' created successfully`),f(),o()}catch(g){n.textContent=g instanceof Error?g.message:"Failed to create role",n.classList.remove("hidden")}finally{h.disabled=!1,h.textContent="Save Role"}}),o()}async function X(m){let t=null;m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Cache Engine</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Unified L1 DashMap (RAM) and L2 SQLite (AOF) telemetry and controls.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="refresh-cache-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${d("refresh","w-3.5 h-3.5 text-[#8c8c8c]")}
            <span>Refresh</span>
          </button>
          <button 
            id="flush-cache-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#141414] hover:bg-rose-500/20 text-[#8c8c8c] hover:text-rose-400 border border-[#262626] hover:border-rose-500/30 rounded-lg text-xs font-medium transition-colors cursor-pointer"
          >
            ${d("trash","w-3.5 h-3.5")}
            <span>Flush Cache</span>
          </button>
        </div>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Overall Hit Ratio</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              ${d("arrow-up-right","w-3.5 h-3.5")}
              <span>L1+L2</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-hit-rate" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">combined</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 30 5, 60 12 T 100 2" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">L1 Active Entries</span>
            <span class="text-xs font-medium text-[#3b82f6] flex items-center gap-0.5">
              ${d("hard-drive","w-3.5 h-3.5")}
              <span>RAM</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-entries" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">live in heap</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 30 18, 70 8 T 100 6" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">LRU Evictions</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              ${d("activity","w-3.5 h-3.5")}
              <span>Threshold</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-evictions" class="text-[26px] font-semibold text-[#f38020] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">evicted</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 22 Q 40 20, 70 12 T 100 8" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Cache Misses</span>
            <span class="text-xs font-medium text-[#8c8c8c] flex items-center gap-0.5">
              <span>SQL Fallback</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="cache-misses" class="text-[26px] font-semibold text-[#cccccc] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">to DB</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 14 Q 30 16, 60 10 T 100 18" fill="none" stroke="#666666" stroke-width="2" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Tier Breakdown Details -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${d("hard-drive","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Multi-Tier Breakdown</h2>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex items-center justify-between p-3.5 rounded-lg bg-[#141414] border border-[#262626]">
              <div>
                <div class="font-medium text-white">L1 RAM Cache (DashMap)</div>
                <div class="text-[11px] text-[#8c8c8c] font-sans mt-0.5">Sub-microsecond latency, true LRU eviction</div>
              </div>
              <div id="l1-hits" class="text-emerald-400 font-semibold tabular-nums">— hits</div>
            </div>

            <div class="flex items-center justify-between p-3.5 rounded-lg bg-[#141414] border border-[#262626]">
              <div>
                <div class="font-medium text-white">L2 Persistent Cache (SQLite AOF)</div>
                <div class="text-[11px] text-[#8c8c8c] font-sans mt-0.5">Survives server restart and power interruption</div>
              </div>
              <div id="l2-hits" class="text-[#3b82f6] font-semibold tabular-nums">— hits</div>
            </div>
          </div>
        </div>

        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-3 text-xs text-[#8c8c8c] leading-relaxed">
          <h2 class="text-sm font-semibold text-white">Engine Durability Invariants</h2>
          <p>
            The unified v4 CacheEngine manages query response caching, per-IP/per-key rate limiting windows, and idempotency replay buffers through a single memory footprint.
          </p>
          <ul class="list-disc pl-5 space-y-1.5 pt-1 text-[#cccccc]">
            <li><strong class="text-white font-medium">L1 Eviction:</strong> Strict least-recently-used (LRU) order when capacity bounds are reached.</li>
            <li><strong class="text-white font-medium">TTL Sweep:</strong> Background BinaryHeap min-heap eviction daemon executing on 60s intervals.</li>
            <li><strong class="text-white font-medium">Cache Stampede Guard:</strong> Single-flight query deduplication prevents downstream thundering herds.</li>
          </ul>
        </div>
      </div>
    </div>
  `;async function e(){try{const s=await k.getCacheStats(),n=s.hits_l1+s.hits_l2,i=n+s.misses,p=i>0?(n/i*100).toFixed(1):"0.0";document.getElementById("cache-hit-rate").textContent=`${p}%`,document.getElementById("cache-entries").textContent=String(s.entries_count),document.getElementById("cache-evictions").textContent=String(s.evictions),document.getElementById("cache-misses").textContent=String(s.misses),document.getElementById("l1-hits").textContent=`${s.hits_l1.toLocaleString()} hits`,document.getElementById("l2-hits").textContent=`${s.hits_l2.toLocaleString()} hits`}catch{}}document.getElementById("refresh-cache-btn")?.addEventListener("click",async()=>{await e(),v.info("Cache statistics refreshed")}),document.getElementById("flush-cache-btn")?.addEventListener("click",()=>{S({title:"Flush Cache Engine",message:"Are you sure you want to flush all L1 RAM and L2 SQLite cache stores? Rate limits, query results, and idempotency keys will be wiped.",confirmText:"Flush All",danger:!0,onConfirm:async()=>{try{await k.flushCache(),v.success("Cache flushed completely"),e()}catch(s){v.error(s instanceof Error?s.message:"Failed to flush cache")}}})}),await e(),t=setInterval(e,1e4);const a=()=>{clearInterval(t),window.removeEventListener("hashchange",a)};window.addEventListener("hashchange",a)}async function Z(m){let t=!0,e=null,a="ALL",s="",n=[];m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Structured Logs</h1>
            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">Stdout/JSON</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Live-tail execution events, control plane mutations, and security telemetry.</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Level Filter -->
          <select 
            id="log-level-filter" 
            class="h-8 px-2.5 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white focus:border-[#3b82f6] outline-none transition-colors"
          >
            <option value="ALL">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          <!-- Search Input -->
          <div class="relative w-44 sm:w-56">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${d("search","w-3.5 h-3.5 opacity-60")}
            </span>
            <input 
              id="log-search-input" 
              type="text" 
              placeholder="Search events..." 
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <!-- Pause / Resume Button -->
          <button 
            id="toggle-tail-btn" 
            type="button"
            class="h-8 px-3 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-xs font-medium text-white transition-colors flex items-center gap-2 cursor-pointer"
          >
            <span id="tail-status-indicator" class="size-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span id="tail-btn-text">Live Tail</span>
          </button>

          <!-- Clear Console -->
          <button 
            id="clear-logs-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Clear buffer"
          >
            ${d("trash","w-3.5 h-3.5")}
          </button>
        </div>
      </div>

      <!-- Log Terminal Display Container matching binary_alive Terminal -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#000000] flex flex-col font-mono text-xs shadow-2xl">
        <div class="bg-[#141414] px-4 h-[40px] border-b border-[#222222] flex items-center justify-between text-[11px] text-[#8c8c8c]">
          <div class="flex items-center gap-2">
            <span class="size-2 rounded-full bg-emerald-400"></span>
            <span class="font-medium text-white">axiom-event-stream</span>
          </div>
          <span id="log-count-indicator" class="tabular-nums">0 events</span>
        </div>

        <div id="log-console-body" class="p-4 space-y-1 overflow-y-auto max-h-[640px] min-h-[400px] select-text">
          <div class="text-[#666666] py-12 text-center font-sans">Connecting to live event stream...</div>
        </div>
      </div>
    </div>
  `;function i(){const b=document.getElementById("log-console-body");if(!b)return;const c=n.filter(r=>{const h=a==="ALL"||r.level===a,g=!s||r.message.toLowerCase().includes(s)||r.target.toLowerCase().includes(s)||r.details&&r.details.toLowerCase().includes(s);return h&&g}),l=document.getElementById("log-count-indicator");if(l&&(l.textContent=`${c.length} event${c.length===1?"":"s"}`),c.length===0){b.innerHTML='<div class="text-[#666666] py-12 text-center font-sans">No log events matching active filter.</div>';return}b.innerHTML=c.map(r=>{let h="text-emerald-400 bg-emerald-500/10 border-emerald-500/20";return r.level==="WARN"?h="text-amber-400 bg-amber-500/10 border-amber-500/20":r.level==="ERROR"&&(h="text-rose-400 bg-rose-500/10 border-rose-500/20"),`
        <div class="py-0.5 flex items-start gap-2.5 text-[12px] leading-relaxed hover:bg-[#111111] px-1.5 rounded transition-colors font-mono">
          <span class="text-[#666666] shrink-0 select-none tabular-nums">${new Date(r.timestamp*1e3).toISOString().replace("T"," ").substring(11,19)}</span>
          <span class="px-1.5 py-0.2 rounded text-[10px] uppercase font-bold border shrink-0 ${h}">${r.level}</span>
          <span class="text-[#3b82f6] font-medium shrink-0">[${r.target}]</span>
          <span class="text-[#f3f4f6] flex-1 break-all">${r.message}</span>
          ${r.details?`<span class="text-[#8c8c8c] text-[11px] shrink-0 truncate max-w-xs">{${r.details}}</span>`:""}
        </div>
      `}).join(""),t&&(b.scrollTop=b.scrollHeight)}async function p(){try{n=(await k.getAuditLog(100,0)).map(c=>{let l="INFO";return c.action.includes("delete")||c.action.includes("fail")||c.action.includes("rotate")?l="WARN":(c.action.includes("ban")||c.action.includes("error"))&&(l="ERROR"),{id:c.id,timestamp:c.timestamp,level:l,target:c.target,message:`${c.actor} executed ${c.action}`,details:c.details}}),i()}catch{}}document.getElementById("log-level-filter")?.addEventListener("change",b=>{a=b.target.value,i()}),document.getElementById("log-search-input")?.addEventListener("input",b=>{s=b.target.value.trim().toLowerCase(),i()});const o=document.getElementById("toggle-tail-btn"),x=document.getElementById("tail-status-indicator"),f=document.getElementById("tail-btn-text");o?.addEventListener("click",()=>{t=!t,t?(x?.classList.remove("bg-amber-400"),x?.classList.add("bg-emerald-400","animate-pulse"),f&&(f.textContent="Live Tail"),p(),e=setInterval(p,2500),v.info("Log live-tail resumed")):(x?.classList.remove("bg-emerald-400","animate-pulse"),x?.classList.add("bg-amber-400"),f&&(f.textContent="Paused"),e&&clearInterval(e),v.info("Log live-tail paused"))}),document.getElementById("clear-logs-btn")?.addEventListener("click",()=>{n=[],i(),v.info("Log buffer cleared")}),await p(),e=setInterval(p,2500);const u=()=>{e&&clearInterval(e),window.removeEventListener("hashchange",u)};window.addEventListener("hashchange",u)}async function Y(m){let t=[],e="",a=1;const s=15;m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-semibold text-white tracking-tight">Audit Trail</h1>
            <span id="audit-count-badge" class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-[#141414] border border-[#262626] text-[#8c8c8c]">0 events</span>
          </div>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Immutable record of control plane mutations, credential issuance, and security actions.</p>
        </div>

        <div class="flex items-center gap-2.5">
          <!-- Search input -->
          <div class="relative w-56 sm:w-72">
            <span class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#8c8c8c]">
              ${d("search","w-3.5 h-3.5 opacity-60")}
            </span>
            <input 
              id="audit-search" 
              type="text" 
              placeholder="Filter by action, actor, target..." 
              class="w-full h-8 pl-8 pr-3 rounded-lg bg-[#0c0c0c] border border-[#262626] text-xs text-white placeholder-[#666666] focus:border-[#3b82f6] outline-none transition-colors"
            />
          </div>

          <button 
            id="refresh-audit-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0" 
            title="Refresh audit log"
          >
            ${d("refresh","w-3.5 h-3.5")}
          </button>
        </div>
      </div>

      <!-- Audit Table Container in Cloudflare DataTable Pattern -->
      <div class="border border-[#262626] rounded-lg overflow-hidden bg-[#0e0e0e] flex flex-col text-[14px]">
        <div class="overflow-x-auto w-full">
          <table class="w-full text-left border-collapse min-w-[760px]">
            <thead class="sticky top-0 z-10">
              <tr class="border-b border-[#222222] bg-[#141414] h-[40px] text-[13px] font-medium text-white">
                <th class="px-4">Event ID</th>
                <th class="px-4">Timestamp</th>
                <th class="px-4">Actor</th>
                <th class="px-4">Action</th>
                <th class="px-4">Target Resource</th>
                <th class="px-4 text-right">Details</th>
              </tr>
            </thead>
            <tbody id="audit-table-body" class="divide-y divide-[#1e1e1e] text-[13px] text-[#cccccc]">
              <tr>
                <td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">
                  <div class="h-4 w-1/3 mx-auto rounded bg-[#1a1a1a] animate-pulse"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Controls matching DataTable.tsx in binary_alive -->
        <div class="flex items-center justify-between px-4 py-2.5 border-t border-[#222222] bg-[#0e0e0e] text-[13px] text-[#8c8c8c]">
          <span id="page-indicator">Showing events</span>
          <div class="flex items-center gap-2 select-none">
            <button 
              id="prev-page-btn" 
              type="button"
              disabled 
              class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              ${d("chevron-left","w-3.5 h-3.5")}
              <span>Previous</span>
            </button>
            <span id="page-number-display" class="px-2 text-xs">Page 1 of 1</span>
            <button 
              id="next-page-btn" 
              type="button"
              disabled 
              class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] text-[#8c8c8c] hover:text-white hover:bg-[#161616] border border-[#262626] hover:border-[#383838] disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
            >
              <span>Next</span>
              ${d("chevron-right","w-3.5 h-3.5")}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Event Detail Modal -->
    <div id="audit-detail-modal" class="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden select-none animate-in fade-in">
      <div class="bg-[#0e0e0e] border border-[#262626] rounded-lg max-w-lg w-full p-6 space-y-4 shadow-2xl">
        <div class="flex items-center justify-between pb-3 border-b border-[#222222]">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            ${d("file-text","w-4 h-4 text-[#f38020]")}
            <span id="modal-event-title">Event Detail</span>
          </div>
          <button id="close-audit-detail" class="text-[#8c8c8c] hover:text-white p-1 cursor-pointer">
            ${d("x","w-4 h-4")}
          </button>
        </div>
        <div class="space-y-3 font-mono text-xs">
          <div class="bg-[#0a0a0b] p-3 rounded-lg border border-[#222222] overflow-x-auto max-h-[360px] overflow-y-auto">
            <pre id="modal-event-json" class="text-[#cccccc] leading-relaxed whitespace-pre-wrap"></pre>
          </div>
        </div>
        <button id="close-audit-detail-btn" class="w-full h-8 bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] text-white text-xs font-medium rounded-lg transition-colors cursor-pointer">
          Close
        </button>
      </div>
    </div>
  `;const n=document.getElementById("audit-detail-modal");function i(u){document.getElementById("modal-event-title").textContent=`Event #${u.id} — ${u.action}`,document.getElementById("modal-event-json").textContent=JSON.stringify(u,null,2),n.classList.remove("hidden")}function p(){if(!e)return t;const u=e.toLowerCase();return t.filter(b=>b.action.toLowerCase().includes(u)||b.actor.toLowerCase().includes(u)||b.target.toLowerCase().includes(u)||b.details&&b.details.toLowerCase().includes(u))}function o(){const u=document.getElementById("audit-table-body"),b=document.getElementById("page-indicator"),c=document.getElementById("page-number-display"),l=document.getElementById("prev-page-btn"),r=document.getElementById("next-page-btn"),h=document.getElementById("audit-count-badge"),g=p(),w=g.length,y=Math.max(1,Math.ceil(w/s));a>y&&(a=y),a<1&&(a=1);const L=(a-1)*s,E=Math.min(L+s,w),$=g.slice(L,E);if(h&&(h.textContent=`${w} event${w===1?"":"s"}`),w===0){u.innerHTML='<tr><td colspan="6" class="px-4 py-12 text-center text-xs text-[#666666]">No audit log events match current query.</td></tr>',b.textContent="Showing 0 events",c.textContent="Page 1 of 1",l.disabled=!0,r.disabled=!0;return}b.innerHTML=`Showing <span class="text-white font-medium tabular-nums">${L+1}–${E}</span> of <span class="text-white font-medium tabular-nums">${w}</span>`,c.innerHTML=`Page <span class="text-white font-medium tabular-nums">${a}</span> of <span class="text-white font-medium tabular-nums">${y}</span>`,l.disabled=a<=1,r.disabled=a>=y,u.innerHTML=$.map(I=>`
      <tr class="h-[44px] hover:bg-[#161616] transition-colors">
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c] tabular-nums">#${I.id}</td>
        <td class="px-4 py-2 font-mono text-xs text-[#8c8c8c] tabular-nums whitespace-nowrap">
          ${new Date(I.timestamp*1e3).toLocaleString()}
        </td>
        <td class="px-4 py-2 font-mono text-xs text-white">
          <div class="flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-[#f38020]"></span>
            <span>${I.actor}</span>
          </div>
        </td>
        <td class="px-4 py-2">
          <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono uppercase bg-[#141414] text-[#f38020] border border-[#262626]">
            ${I.action}
          </span>
        </td>
        <td class="px-4 py-2 font-mono text-xs text-white">${I.target}</td>
        <td class="px-4 py-2 text-right">
          <button 
            data-audit-id="${I.id}" 
            class="h-7 px-2.5 rounded bg-[#141414] hover:bg-[#1a1a1a] border border-[#262626] hover:border-[#383838] text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Inspect
          </button>
        </td>
      </tr>
    `).join(""),u.querySelectorAll("[data-audit-id]").forEach(I=>{I.addEventListener("click",j=>{const H=parseInt(j.currentTarget.getAttribute("data-audit-id")||"0",10),T=t.find(q=>q.id===H);T&&i(T)})})}async function x(){try{t=await k.getAuditLog(500,0),o()}catch{const u=document.getElementById("audit-table-body");u.innerHTML='<tr><td colspan="6" class="px-4 py-8 text-center text-rose-400 text-xs">Failed to load audit records.</td></tr>'}}document.getElementById("audit-search")?.addEventListener("input",u=>{e=u.target.value.trim(),a=1,o()}),document.getElementById("refresh-audit-btn")?.addEventListener("click",async()=>{await x(),v.info("Audit trail refreshed")}),document.getElementById("prev-page-btn")?.addEventListener("click",()=>{a>1&&(a--,o())}),document.getElementById("next-page-btn")?.addEventListener("click",()=>{a++,o()});const f=()=>n.classList.add("hidden");document.getElementById("close-audit-detail")?.addEventListener("click",f),document.getElementById("close-audit-detail-btn")?.addEventListener("click",f),n.addEventListener("click",u=>{u.target===n&&f()}),await x()}function ee(m){const t=m.split(`
`),e=[];for(const a of t){const s=a.trim();if(!s||s.startsWith("#"))continue;const n=s.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([0-9.eE+-]+)/);if(!n)continue;const i=n[1],p=n[2]||"",o=parseFloat(n[3]),x={};if(p){const f=p.split(",");for(const u of f){const[b,c]=u.split("=");b&&c&&(x[b.trim()]=c.trim().replace(/^"|"$/g,""))}}e.push({name:i,labels:x,value:o})}return e}async function te(m){let t=!1;m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">Gateway Metrics</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Runtime telemetry exported at <code class="text-[#f38020] font-mono">/metrics</code>.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="toggle-raw-btn" 
            type="button"
            class="h-8 px-3 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            Toggle Raw
          </button>
          <button 
            id="copy-raw-metrics" 
            type="button"
            class="flex items-center gap-1.5 h-8 px-3 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${d("copy","w-3.5 h-3.5 text-[#8c8c8c]")}
            <span>Copy Text</span>
          </button>
          <button 
            id="refresh-metrics-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Refresh metrics"
          >
            ${d("refresh","w-3.5 h-3.5")}
          </button>
        </div>
      </div>

      <!-- Telemetry Cards Grid matching binary_alive TelemetryCard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">HTTP Requests (Total)</span>
            <span class="text-xs font-medium text-[#3b82f6] flex items-center gap-0.5">
              <span>Traffic</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-http-total" class="text-[26px] font-semibold text-white tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">inbound</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 18 Q 30 10, 60 14 T 100 4" fill="none" stroke="#3b82f6" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Database Queries</span>
            <span class="text-xs font-medium text-[#f38020] flex items-center gap-0.5">
              <span>Upstream</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-db-total" class="text-[26px] font-semibold text-[#f38020] tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">executed</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 16 Q 40 8, 70 14 T 100 6" fill="none" stroke="#f38020" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Active Sockets</span>
            <span class="text-xs font-medium text-emerald-400 flex items-center gap-0.5">
              <span>Pool</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-conns-total" class="text-[26px] font-semibold text-emerald-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">connections</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 20 Q 30 14, 60 16 T 100 4" fill="none" stroke="#10b981" stroke-width="2" />
            </svg>
          </div>
        </div>

        <div class="rounded-lg bg-[#0e0e0e] border border-[#222222] p-4 relative overflow-hidden">
          <div class="flex items-center justify-between text-[#8c8c8c] mb-1">
            <span class="text-xs font-normal">Rate Limit Rejections</span>
            <span class="text-xs font-medium text-rose-400 flex items-center gap-0.5">
              <span>Drops</span>
            </span>
          </div>
          <div class="flex items-baseline gap-2 mt-1">
            <span id="metric-rl-total" class="text-[26px] font-semibold text-rose-400 tracking-[-0.02em] font-sans tabular-nums">—</span>
            <span class="text-xs text-[#8c8c8c]">blocked</span>
          </div>
          <div class="w-full h-8 mt-2 flex items-end">
            <svg class="w-full h-full" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0 12 Q 30 18, 60 15 T 100 22" fill="none" stroke="#ef4444" stroke-width="2" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Breakdown Panels -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Inbound HTTP Breakdown -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#3b82f6]/10 text-[#3b82f6]">
              ${d("activity","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Inbound HTTP Operations</h2>
          </div>
          <div id="http-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-[#666666] py-6 text-center font-sans">Parsing telemetry...</div>
          </div>
        </div>

        <!-- Database Breakdown -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${d("database","w-4 h-4")}
            </span>
            <h2 class="text-sm font-semibold text-white">Database Query Distribution</h2>
          </div>
          <div id="db-breakdown-list" class="space-y-2 text-xs font-mono">
            <div class="text-[#666666] py-6 text-center font-sans">Parsing telemetry...</div>
          </div>
        </div>
      </div>

      <!-- Raw Exposition Block -->
      <div id="raw-metrics-section" class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-4 space-y-3 hidden shadow-2xl">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-white">Raw Prometheus Exposition</span>
          <span class="text-[11px] text-[#8c8c8c] font-mono">text/plain; version=0.0.4</span>
        </div>
        <div class="bg-[#000000] border border-[#222222] rounded-lg p-4 overflow-x-auto max-h-[480px] overflow-y-auto">
          <pre id="raw-metrics-display" class="font-mono text-xs text-[#cccccc] leading-relaxed whitespace-pre">Loading metrics...</pre>
        </div>
      </div>
    </div>
  `;let e="";async function a(){try{e=await k.getRawMetrics();const s=document.getElementById("raw-metrics-display");s&&(s.textContent=e);const n=ee(e),i=n.filter(l=>l.name.includes("http_requests_total")).reduce((l,r)=>l+r.value,0);document.getElementById("metric-http-total").textContent=String(i);const p=n.filter(l=>l.name.includes("db_queries_total")).reduce((l,r)=>l+r.value,0);document.getElementById("metric-db-total").textContent=String(p);const o=n.filter(l=>l.name.includes("pool_connections_active")).reduce((l,r)=>l+r.value,0);document.getElementById("metric-conns-total").textContent=String(o);const x=n.filter(l=>l.name.includes("rate_limit_rejections_total")||l.name.includes("rate_limit_rejected")).reduce((l,r)=>l+r.value,0);document.getElementById("metric-rl-total").textContent=String(x);const f=n.filter(l=>l.name.includes("http_requests_total")),u=document.getElementById("http-breakdown-list");f.length>0?u.innerHTML=f.map(l=>`
          <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#141414] border border-[#262626] text-xs">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-[#1a1a1a] text-white font-medium uppercase font-mono">${l.labels.method||"GET"}</span>
              <span class="text-[#f3f4f6] truncate max-w-xs font-mono">${l.labels.path||"/"}</span>
              ${l.labels.status?`<span class="text-[#8c8c8c]">(${l.labels.status})</span>`:""}
            </div>
            <span class="text-emerald-400 font-medium tabular-nums">${l.value} calls</span>
          </div>
        `).join(""):u.innerHTML='<div class="text-[#666666] py-6 text-center font-sans">No HTTP requests recorded since startup.</div>';const b=n.filter(l=>l.name.includes("db_queries_total")),c=document.getElementById("db-breakdown-list");b.length>0?c.innerHTML=b.map(l=>`
          <div class="flex items-center justify-between p-2.5 rounded-lg bg-[#141414] border border-[#262626] text-xs">
            <div class="flex items-center gap-2">
              <span class="px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#3b82f6] border border-[#262626] font-mono font-medium uppercase">
                ${l.labels.alias||"main"}
              </span>
              <span class="text-white font-mono">${l.labels.operation||"QUERY"}</span>
            </div>
            <span class="text-[#f38020] font-medium tabular-nums">${l.value} queries</span>
          </div>
        `).join(""):c.innerHTML='<div class="text-[#666666] py-6 text-center font-sans">No database queries recorded since startup.</div>'}catch{const s=document.getElementById("raw-metrics-display");s&&(s.textContent="Failed to scrape /metrics endpoint.")}}document.getElementById("refresh-metrics-btn")?.addEventListener("click",async()=>{await a(),v.info("Metrics refreshed")}),document.getElementById("toggle-raw-btn")?.addEventListener("click",()=>{t=!t;const s=document.getElementById("raw-metrics-section");s&&(t?s.classList.remove("hidden"):s.classList.add("hidden"))}),document.getElementById("copy-raw-metrics")?.addEventListener("click",async()=>{e&&(await navigator.clipboard.writeText(e),v.success("Prometheus exposition copied to clipboard"))}),a()}async function se(m){m.innerHTML=`
    <div class="space-y-6 max-w-7xl w-full mx-auto select-none">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-white tracking-tight">System Diagnostics</h1>
          <p class="text-xs text-[#8c8c8c] mt-0.5">Runtime architecture, kernel diagnostics, and memory subsystem telemetry.</p>
        </div>
        <div class="flex items-center gap-2">
          <button 
            id="copy-sys-diag-btn" 
            type="button"
            class="flex items-center gap-1.5 px-3 h-8 bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] rounded-lg text-xs font-medium text-[#cccccc] hover:text-white transition-colors cursor-pointer"
          >
            ${d("copy","w-3.5 h-3.5 text-[#8c8c8c]")}
            <span>Copy Diagnostics</span>
          </button>
          <button 
            id="refresh-sys-btn" 
            type="button"
            class="size-8 rounded-lg bg-[#0c0c0c] hover:bg-[#161616] border border-[#262626] text-[#8c8c8c] hover:text-white transition-colors flex items-center justify-center cursor-pointer" 
            title="Refresh diagnostics"
          >
            ${d("refresh","w-3.5 h-3.5")}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Runtime Details Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            <span class="p-1.5 rounded-md bg-[#f38020]/10 text-[#f38020]">
              ${d("server","w-4 h-4")}
            </span>
            <span>Runtime Specifications</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Binary Version</span>
              <span class="text-white font-medium">Axiom v4.0.0</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Async Runtime</span>
              <span class="text-white">Tokio Multi-Threaded</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Memory Allocator</span>
              <span class="text-white">mimalloc (secure zero-on-free)</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Metadata Store</span>
              <span class="text-white">libsql (local axiom.db / remote Turso)</span>
            </div>
            <div class="flex justify-between py-2">
              <span class="text-[#8c8c8c] font-sans">Protocol Handlers</span>
              <span class="text-white">HTTP/1.1 REST + MCP v1 + Prometheus</span>
            </div>
          </div>
        </div>

        <!-- Live Diagnostics Panel -->
        <div class="bg-[#0e0e0e] border border-[#222222] rounded-lg p-5 space-y-4">
          <div class="flex items-center gap-2 text-white font-semibold text-sm">
            <span class="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400">
              ${d("activity","w-4 h-4")}
            </span>
            <span>Live Process Telemetry</span>
          </div>

          <div class="space-y-2.5 text-xs font-mono">
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Process Uptime</span>
              <span id="sys-uptime" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Resident Set Size (RSS)</span>
              <span id="sys-mem" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Process CPU Utilization</span>
              <span id="sys-cpu" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2 border-b border-[#1e1e1e]">
              <span class="text-[#8c8c8c] font-sans">Active Connection Pools</span>
              <span id="sys-pools" class="text-white font-semibold tabular-nums">—</span>
            </div>
            <div class="flex justify-between py-2">
              <span class="text-[#8c8c8c] font-sans">Registered Client Keys</span>
              <span id="sys-keys" class="text-white font-semibold tabular-nums">—</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;let t="";async function e(){try{const a=await k.getStatus(),s=Math.floor(a.uptime_seconds/60),n=s<60?`${s} minutes`:`${Math.floor(s/60)}h ${s%60}m`;document.getElementById("sys-uptime").textContent=n,document.getElementById("sys-mem").textContent=`${a.memory_mb} MB`,document.getElementById("sys-cpu").textContent=`${a.cpu_percent.toFixed(1)}%`,document.getElementById("sys-pools").textContent=`${a.active_databases} databases`,document.getElementById("sys-keys").textContent=`${a.registered_keys} keys`,t=JSON.stringify(a,null,2)}catch{}}document.getElementById("copy-sys-diag-btn")?.addEventListener("click",async()=>{t&&(await navigator.clipboard.writeText(t),v.success("System diagnostics copied to clipboard"))}),document.getElementById("refresh-sys-btn")?.addEventListener("click",async()=>{await e(),v.info("Diagnostics refreshed")}),e()}const B=document.getElementById("app");let C=!1;K();async function P(){const m=window.location.hash||"#/overview";try{if((await k.checkSetupStatus()).setup_required){if(m!=="#/setup"){window.location.hash="#/setup";return}U(B);return}else if(m==="#/setup"){window.location.hash="#/login";return}}catch{}if(m==="#/login"){G(B);return}if(!localStorage.getItem("axiom_session_token")){window.location.hash="#/login";return}const e=m.replace("#/","").split("?")[0]||"overview";B.innerHTML=`
    <div class="flex min-h-screen bg-[#000000] text-[#f3f4f6] font-sans">
      <div id="sidebar-container"></div>
      <div class="flex-1 flex flex-col min-w-0 min-h-screen">
        <div id="navbar-container"></div>
        <main id="main-content" class="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex flex-col focus:outline-none"></main>
      </div>
    </div>
  `;const a=()=>{C=!C,n()},s=()=>{C&&(C=!1,n())},n=()=>{const o=document.getElementById("sidebar-container");o&&(o.innerHTML=D(e,C,s),document.getElementById("sidebar-close-btn")?.addEventListener("click",s))},i=document.getElementById("navbar-container");i.innerHTML=Q(a),n();const p=document.getElementById("main-content");switch(p.scrollTop=0,e){case"overview":R(p);break;case"databases":V(p);break;case"keys":W(p);break;case"roles":J(p);break;case"cache":X(p);break;case"logs":Z(p);break;case"audit":Y(p);break;case"metrics":te(p);break;case"system":se(p);break;default:R(p);break}}window.addEventListener("keydown",m=>{if(m.key==="Escape"&&C){C=!1;const t=document.getElementById("sidebar-container");if(t){const e=(window.location.hash||"#/overview").replace("#/","").split("?")[0]||"overview";t.innerHTML=D(e,!1,()=>{})}}});window.addEventListener("hashchange",()=>{C=!1,P()});P();
