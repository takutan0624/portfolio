import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
const root = process.cwd();
const port = process.env.PORT || 5510;
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'};
createServer(async (req,res)=>{
  try{
    let p = decodeURIComponent(req.url.split('?')[0]);
    if(p.endsWith('/')) p += 'index.html';
    const fp = normalize(join(root, p));
    if(!fp.startsWith(root)){res.writeHead(403);return res.end('no');}
    const data = await readFile(fp);
    res.writeHead(200,{'Content-Type':types[extname(fp)]||'application/octet-stream'});
    res.end(data);
  }catch(e){res.writeHead(404);res.end('not found');}
}).listen(port,()=>console.log('listening on '+port));
