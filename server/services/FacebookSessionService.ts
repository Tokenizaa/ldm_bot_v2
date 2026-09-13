import { FacebookSessionStatus } from '../types.js';
import { logger } from './LoggerService.js';
import { facebookBrowser } from './FacebookBrowserService.js';
import { storage } from './StorageService.js';
import { normalizeGroupUrl } from '../utils/idempotency.js';

export class FacebookSessionService {
  private status: FacebookSessionStatus = { connected:false,status:'disconnected',profile_dir:facebookBrowser.getProfileDir(),details:'Perfil persistente do Facebook configurado.' };
  private sessionLock:Promise<void>=Promise.resolve();
  private readonly sessionHealthTtlMs=5*60*1000;
  private async withLock<T>(operation:()=>Promise<T>):Promise<T>{const previous=this.sessionLock;let release!:()=>void;this.sessionLock=new Promise<void>(resolve=>{release=resolve;});await previous;try{return await operation();}finally{release();}}
  getStatus():FacebookSessionStatus{return{...this.status};}
  private async isLoginPage():Promise<boolean>{try{const page=await facebookBrowser.getOperationalPage();const currentUrl=page.url();if(/\/login|\/checkpoint|\/recover/i.test(currentUrl))return true;return await page.locator('input[name="email"], input[name="pass"], form[action*="login"]').count().catch(()=>0)>0;}catch{return false;}}
  private isGroupUrlMatch(currentUrl:string,targetGroupUrl:string):boolean{try{const currentObj=new URL(currentUrl),targetObj=new URL(targetGroupUrl);return currentObj.origin===targetObj.origin&&currentObj.pathname.replace(/\/+$/,'')===targetObj.pathname.replace(/\/+$/,'');}catch{return false;}}

  private async waitForGroupOperational(page:any,targetUrl:string):Promise<boolean>{
    const expected=new URL(targetUrl),pathname=expected.pathname.replace(/\/+$/,'');
    return page.waitForFunction(({origin,pathname})=>{
      if(window.location.origin!==origin||window.location.pathname.replace(/\/+$/,'')!==pathname)return false;
      const body=(document.body?.innerText||'').slice(0,2000);
      return !!document.querySelector('main,[role="main"],[role="feed"],[aria-label="Escreva algo..."],[aria-label="No que você está pensando?"]') || /Facebook/i.test(document.title) || body.length>100;
    },{origin:expected.origin,pathname},{timeout:20000,polling:100});
  }

  async start(timeoutMs=0):Promise<FacebookSessionStatus>{return this.withLock(async()=>{try{
    const page=await facebookBrowser.closeExtraPages();
    const settings=await storage.getSettings().catch(()=>({facebook_group_url:''}));
    const targetUrl=settings?.facebook_group_url?normalizeGroupUrl(settings.facebook_group_url):'';
    const cookies=await facebookBrowser.cookies();
    const hasCookies=cookies.some(c=>c.name==='c_user'&&!!c.value)&&cookies.some(c=>c.name==='xs'&&!!c.value);
    if(!hasCookies){
      if(!page.url()||page.url()==='about:blank')await page.goto(targetUrl||'https://www.facebook.com',{waitUntil:'commit',timeout:45000}).catch(err=>logger.facebook(`Aviso na navegação inicial de login: ${err.message}`,'warn'));
      if(timeoutMs<=0){this.status={...this.status,connected:false,status:'requires_reauth',configured_group_url:targetUrl||undefined,group_accessible:false,details:'Facebook requer autenticação no navegador persistente (cookies c_user e xs ausentes).'};return this.getStatus();}
      this.status={...this.status,connected:false,status:'connecting',configured_group_url:targetUrl||undefined,group_accessible:false,details:'Aguardando autenticação no navegador persistente.'};
      const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){await page.waitForTimeout(1000);const fresh=await facebookBrowser.cookies();const authed=fresh.some(c=>c.name==='c_user'&&!!c.value)&&fresh.some(c=>c.name==='xs'&&!!c.value);if(authed&&!await this.isLoginPage())break;}
      const fresh=await facebookBrowser.cookies();const authed=fresh.some(c=>c.name==='c_user'&&!!c.value)&&fresh.some(c=>c.name==='xs'&&!!c.value);if(!authed||await this.isLoginPage()){this.status={...this.status,connected:false,status:'requires_reauth',configured_group_url:targetUrl||undefined,group_accessible:false,details:'Tempo limite esgotado. Facebook requer autenticação no navegador.'};return this.getStatus();}
    }
    if(targetUrl){
      logger.facebook(`[Startup] Verificando posicionamento e acesso no grupo alvo: ${targetUrl}`);
      if(!this.isGroupUrlMatch(page.url(),targetUrl)){
        logger.facebook(`[Startup] Navegando página operacional única para o grupo: ${targetUrl}`);
        await page.goto(targetUrl,{waitUntil:'commit',timeout:60000});
        await this.waitForGroupOperational(page,targetUrl);
      }
      const afterNavUrl=page.url();
      if(/\/login|\/checkpoint|\/recover/i.test(afterNavUrl)){this.status={...this.status,connected:false,status:'requires_reauth',configured_group_url:targetUrl,group_accessible:false,details:`Redirecionado para tela de autenticação/checkpoint (${afterNavUrl}).`};logger.facebook(`[Startup] Redirecionamento para checkpoint detectado: ${afterNavUrl}`,'warn');return this.getStatus();}
      let groupAccessible=false,details=`Sessão ativa e confirmada no grupo alvo: ${targetUrl}`;
      try{const bodyText=await page.locator('body').innerText({timeout:1500}).then(t=>t.slice(0,1200)).catch(()=>'');if(/Este conteúdo não está disponível|This content isn't available/i.test(bodyText)){details='Conta autenticada, mas o grupo alvo está inacessível (não encontrado ou permissão insuficiente).';logger.facebook(`[Startup] Conteúdo indisponível no grupo: ${targetUrl}`,'warn');}else{const composerCount=await page.locator("[aria-label='Escreva algo...']:visible,[aria-label='No que você está pensando?']:visible,[aria-label='Criar publicação']:visible").count().catch(()=>0),mainCount=await page.locator('main,[role="main"],[role="feed"]').count().catch(()=>0);groupAccessible=composerCount>0||mainCount>0||/Facebook/i.test(await page.title().catch(()=>''));}}catch(e:any){logger.facebook(`[Startup] Aviso ao verificar elementos do grupo: ${e.message}`,'warn');}
      await facebookBrowser.closeExtraPages();
      this.status={...this.status,connected:true,status:'connected',configured_group_url:targetUrl,group_accessible:groupAccessible,connected_user:'Conta Facebook autenticada',last_authenticated_at:new Date().toISOString(),details};
      logger.facebook(`[Startup] Verificação de sessão concluída. Grupo acessível: ${groupAccessible}`,groupAccessible?'success':'warn');return this.getStatus();
    }
    if(!page.url()||page.url()==='about:blank')await page.goto('https://www.facebook.com',{waitUntil:'commit',timeout:45000}).catch(()=>undefined);
    this.status={...this.status,connected:true,status:'connected',configured_group_url:undefined,group_accessible:false,connected_user:'Conta Facebook autenticada',last_authenticated_at:new Date().toISOString(),details:'Facebook autenticado. Configure o URL do grupo nas configurações.'};return this.getStatus();
  }catch(error:any){this.status={...this.status,connected:false,status:'requires_reauth',details:error.message};logger.facebook(`Falha na verificação de sessão de startup: ${error.message}`,'error');return this.getStatus();}});}
  async refresh():Promise<FacebookSessionStatus>{return this.start(0);}
  async connect():Promise<{success:boolean;message:string;connectedUser?:string}>{const status=await this.start(60000);return status.connected?{success:true,message:'Facebook conectado no navegador persistente.',connectedUser:status.connected_user}:{success:false,message:status.details||'Facebook requer autenticação.'};}
  async requireAuthenticated():Promise<void>{const lastAuthenticated=this.status.last_authenticated_at?Date.parse(this.status.last_authenticated_at):0;const fresh=this.status.connected&&this.status.group_accessible!==false&&Number.isFinite(lastAuthenticated)&&Date.now()-lastAuthenticated<this.sessionHealthTtlMs;if(fresh){logger.facebook('[Session] Saúde da sessão reutilizada; nova verificação completa adiada pelo TTL.');return;}const status=await this.refresh();if(!status.connected)throw new Error('FACEBOOK_REAUTH_REQUIRED');}
}
export const facebookSession=new FacebookSessionService();