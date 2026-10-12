import type {IncomingMessage} from 'node:http';

function origin(value:string){
 try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash?url.origin:'';}catch{return '';}
}

export function requestPolicy(publicUrl:string,port:number,env:NodeJS.ProcessEnv=process.env){
 const localHosts=new Set([`localhost:${port}`,`127.0.0.1:${port}`,`[::1]:${port}`]);
 const localOrigins=new Set([...localHosts].flatMap(host=>[`http://${host}`,`https://${host}`]));
 const namedCodespace=env.CODESPACES==='true'&&Boolean(env.CODESPACE_NAME)&&Boolean(env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN)&&publicUrl===`https://${env.CODESPACE_NAME}-${port}.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
 function directAllowed(value:string){const parsed=origin(value);return Boolean(parsed)&&(publicUrl?parsed===publicUrl:localOrigins.has(parsed)&&parsed.startsWith('http:'));}
 function codespaceProxy(req:IncomingMessage){
  const peer=req.socket.remoteAddress;
  if(!namedCodespace||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer||''))return false;
  if(!localHosts.has(req.headers.host||''))return false;
  const forwarded=req.headers['x-forwarded-host'];
  // A supplied original host must match this exact Codespace; never trust arbitrary forwarded hosts.
  return !forwarded||(typeof forwarded==='string'&&directAllowed(`https://${forwarded}`));
 }
 return {
  hostAllowed(req:IncomingMessage){return directAllowed(`${publicUrl.startsWith('https:')?'https:':'http:'}//${req.headers.host||''}`)||codespaceProxy(req);},
  postAllowed(req:IncomingMessage){
   if(directAllowed(req.headers.origin||''))return true;
   // Codespaces can rewrite same-origin requests to localhost. The custom header requires
   // a successful CORS preflight for cross-origin callers; this server never permits one.
   const requestOrigin=origin(req.headers.origin||'');
   const directCodespaceHost=directAllowed(`https://${req.headers.host||''}`);
   const peer=req.socket.remoteAddress;
   const localPeer=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer||'');
   return Boolean(namedCodespace&&localPeer&&(codespaceProxy(req)||directCodespaceHost)&&localOrigins.has(requestOrigin)&&req.headers['x-studio-request']==='1');
  },
 };
}
