import fs from 'fs';
import path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { logger } from './LoggerService.js';

export class FacebookBrowserService {
  private readonly profileDir=path.join(process.cwd(),'data','browser-profiles','facebook');
  private context:BrowserContext|null=null;
  private startPromise:Promise<BrowserContext>|null=null;
  private operationalPage:Page|null=null;
  private readonly pageHealthTimeoutMs=1500;

  constructor(){if(!fs.existsSync(this.profileDir))fs.mkdirSync(this.profileDir,{recursive:true});}
  async start():Promise<BrowserContext>{if(this.context)return this.context;if(this.startPromise)return this.startPromise;if(!fs.existsSync(this.profileDir))fs.mkdirSync(this.profileDir,{recursive:true});const isHeadless=process.env.HEADLESS!=='false'&&!process.env.DISPLAY;const launchOptions:any={headless:isHeadless,viewport:{width:1280,height:800},args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']};if(process.env.FACEBOOK_BROWSER_CHANNEL)launchOptions.channel=process.env.FACEBOOK_BROWSER_CHANNEL;this.startPromise=(async()=>{try{const context=await chromium.launchPersistentContext(this.profileDir,launchOptions);this.context=context;this.setupContext(context);return context;}catch(err:any){if(launchOptions.channel){logger.facebook(`Falha com channel=${launchOptions.channel}, tentando chromium padrão: ${err.message}`,'warn');delete launchOptions.channel;const context=await chromium.launchPersistentContext(this.profileDir,launchOptions);this.context=context;this.setupContext(context);return context;}this.startPromise=null;throw err;}})();return this.startPromise;}
  private setupContext(context:BrowserContext):void{const available=context.pages().filter(p=>!p.isClosed());const initialPage=available[0]||null;if(initialPage){this.operationalPage=initialPage;this.bindPageEvents(initialPage);for(const extra of available.slice(1))extra.close().catch(()=>undefined);}context.on('page',async(newPage)=>{try{if(this.operationalPage&&newPage!==this.operationalPage&&!newPage.isClosed()){logger.facebook(`Popup ou aba secundária interceptada (${newPage.url()||'nova'}). Fechando imediatamente para manter aba operacional única.`);await newPage.close().catch(()=>undefined);if(this.operationalPage&&!this.operationalPage.isClosed())await this.operationalPage.bringToFront().catch(()=>undefined);}}catch(err:any){logger.facebook(`Erro ao interceptar aba secundária: ${err.message}`,'warn');}});context.on('close',()=>{this.context=null;this.startPromise=null;this.operationalPage=null;logger.facebook('Browser persistente do Facebook encerrado.','warn');});}
  private bindPageEvents(page:Page):void{page.on('close',()=>{if(this.operationalPage===page){this.operationalPage=null;logger.facebook('operationalPage fechada. Referência limpa.','warn');}});page.on('crash',()=>{if(this.operationalPage===page){this.operationalPage=null;logger.facebook('operationalPage sofreu crash. Referência limpa.','error');}});}
  async closeExtraPages():Promise<Page>{const context=await this.start();const pages=context.pages().filter(p=>!p.isClosed());if(this.operationalPage&&!this.operationalPage.isClosed()){try{await this.operationalPage.evaluate(()=>document.readyState,{timeout:this.pageHealthTimeoutMs});for(const p of pages)if(p!==this.operationalPage&&!p.isClosed())await p.close().catch(()=>undefined);await this.operationalPage.bringToFront().catch(()=>undefined);return this.operationalPage;}catch(err:any){logger.facebook(`operationalPage existente não respondeu rapidamente (${err.message}). Recuperando...`,'warn');this.operationalPage=null;}}
    const remaining=context.pages().filter(p=>!p.isClosed());if(remaining.length>0){this.operationalPage=remaining[0];this.bindPageEvents(this.operationalPage);for(const extra of remaining.slice(1))await extra.close().catch(()=>undefined);}else{this.operationalPage=await context.newPage();this.bindPageEvents(this.operationalPage);}await this.operationalPage.bringToFront().catch(()=>undefined);return this.operationalPage;}
  async getOperationalPage():Promise<Page>{return this.closeExtraPages();}
  async page():Promise<Page>{return this.getOperationalPage();}
  setOperationalPage(page:Page):void{this.operationalPage=page;}
  async resetOperationalPage():Promise<void>{if(this.operationalPage&&!this.operationalPage.isClosed())await this.operationalPage.close().catch(()=>undefined);this.operationalPage=null;}
  async cookies(){const context=await this.start();return context.cookies('https://www.facebook.com');}
  async close():Promise<void>{if(!this.context)return;this.operationalPage=null;await this.context.close();this.context=null;this.startPromise=null;}
  getProfileDir():string{return'data/browser-profiles/facebook';}
}
export const facebookBrowser=new FacebookBrowserService();