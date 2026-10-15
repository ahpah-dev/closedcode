export type DesktopConnection = {baseUrl:string;token:string;workspace:string;desktop:true};
declare global {
 interface Window { closedcodeDesktop?: {getConnection:()=>Promise<DesktopConnection>;chooseDirectory:()=>Promise<{workspace?:string;cancelled?:boolean}>;getVersion:()=>Promise<string>;openLocalPreview?:(url:string)=>Promise<{opened:boolean;url:string}>}; }
}
