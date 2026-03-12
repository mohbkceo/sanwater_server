
function deepMerge(target, source, schema) {
  if(!source || typeof source != 'object') return;

  for(const key of Object.keys(schema)){
    if(!(key in source)) continue;

    let rule = schema[key];
    let sourceValue = source[key];

    if(rule === true){
      target[key] = sourceValue;
    } else if (typeof rule === 'object') {
      target[key] ??= {}
      deepMerge(target[key], sourceValue, rule)
    }
  }
}


function logTrafic(req, res, next){
  const origin = req.headers.origin || "no-origin-header";
   const host = req.headers.host;
   const ip =
     req.headers["x-forwarded-for"]?.split(",")[0] ||
     req.socket.remoteAddress;

   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
   console.log(`Origin: ${origin}`);
   console.log(`Host: ${host}`);
   console.log(`IP: ${ip}`);
   console.log("----");

  next();
}

const allowedOrigin = ['https://sanwater-dz.com/', "http://localhost:5173", "https://sanwaterfrontendproject.vercel.app"]



module.exports = { deepMerge, logTrafic, allowedOrigin }