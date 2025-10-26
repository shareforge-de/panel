//
// Heliactyl 12.1, Codename Kyiv
// 
//  * Copyright Sryden UK 2022
//  * Please read the "License" file
//  * #SupportUkraine
//

"use strict";

// Load packages.

const fs = require("fs");
const fetch = require('node-fetch');
const chalk = require("chalk");
const axios = require("axios");
const arciotext = require('./stuff/arciotext')
global.Buffer = global.Buffer || require('buffer').Buffer;

if (typeof btoa === 'undefined') {
  global.btoa = function (str) {
    return new Buffer(str, 'binary').toString('base64');
  };
}
if (typeof atob === 'undefined') {
  global.atob = function (b64Encoded) {
    return new Buffer(b64Encoded, 'base64').toString('binary');
  };
}

// Load settings.

const settings = require("./settings.json");

const defaultthemesettings = {
  index: "index.ejs",
  notfound: "index.ejs",
  redirect: {},
  pages: {},
  mustbeloggedin: [],
  mustbeadmin: [],
  variables: {}
};

module.exports.renderdataeval =
  `(async () => {
   let newsettings = JSON.parse(require("fs").readFileSync("./settings.json"));
	const JavaScriptObfuscator = require('javascript-obfuscator');

 
    let renderdata = {
      req: req,
      settings: newsettings,
      userinfo: req.session.userinfo,
      packagename: req.session.userinfo ? await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : newsettings.api.client.packages.default : null,
      extraresources: !req.session.userinfo ? null : (await db.get("extra-" + req.session.userinfo.id) ? await db.get("extra-" + req.session.userinfo.id) : {
        ram: 0,
        disk: 0,
        cpu: 0,
        servers: 0
      }),
		packages: req.session.userinfo ? newsettings.api.client.packages.list[await db.get("package-" + req.session.userinfo.id) ? await db.get("package-" + req.session.userinfo.id) : newsettings.api.client.packages.default] : null,
      coins: newsettings.api.client.coins.enabled == true ? (req.session.userinfo ? (await db.get("coins-" + req.session.userinfo.id) ? await db.get("coins-" + req.session.userinfo.id) : 0) : null) : null,
      pterodactyl: req.session.pterodactyl,
      theme: theme.name,
      extra: theme.settings.variables,
	  db: db
    };
    if (newsettings.api.arcio.enabled == true && req.session.arcsessiontoken) {
      renderdata.arcioafktext = JavaScriptObfuscator.obfuscate(\`
        let token = "\${req.session.arcsessiontoken}";
        let everywhat = \${newsettings.api.arcio["afk page"].every};
        let gaincoins = \${newsettings.api.arcio["afk page"].coins};
        let arciopath = "\${newsettings.api.arcio["afk page"].path.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"")}";

        \${arciotext}
      \`);
    };

    return renderdata;
  })();`;

// Load database

const Keyv = require("keyv");
const db = new Keyv(settings.database);

db.on('error', err => {
  console.log(chalk.red("[DATABASE] An error has occured when attempting to access the database."))
});

module.exports.db = db;

// Load websites.

const express = require("express");
const app = express();
require('express-ws')(app);

// Load express addons.

const ejs = require("ejs");
const session = require("express-session");
const indexjs = require("./index.js");

// Load the website.

module.exports.app = app;

app.use(session({secret: settings.website.secret, resave: false, saveUninitialized: false}));

app.use(express.json({
  inflate: true,
  limit: '500kb',
  reviver: null,
  strict: true,
  type: 'application/json',
  verify: undefined
}));

const listener = app.listen(settings.website.port, function() {
  console.log(chalk.green("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――"));
  console.log(chalk.green("Heliactyl V12 is now online at port " + listener.address().port + " "));
  console.log(chalk.green("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――"));
});

var cache = false;
app.use(function(req, res, next) {
  let manager = (JSON.parse(fs.readFileSync("./settings.json").toString())).api.client.ratelimits;
  if (manager[req._parsedUrl.pathname]) {
    if (cache == true) {
      setTimeout(async () => {
        let allqueries = Object.entries(req.query);
        let querystring = "";
        for (let query of allqueries) {
          querystring = querystring + "&" + query[0] + "=" + query[1];
        }
        querystring = "?" + querystring.slice(1);
        res.redirect((req._parsedUrl.pathname.slice(0, 1) == "/" ? req._parsedUrl.pathname : "/" + req._parsedUrl.pathname) + querystring);
      }, 1000);
      return;
    } else {
      cache = true;
      setTimeout(async () => {
        cache = false;
      }, 1000 * manager[req._parsedUrl.pathname]);
    }
  };
  next();
});

// Load the API files.

let apifiles = fs.readdirSync('./api').filter(file => file.endsWith('.js'));

apifiles.forEach(file => {
  let apifile = require(`./api/${file}`);
	apifile.load(app, db);
});


// AFK Heartbeat Route (Backend-Centric Coin Awarding via Keyv/SQLite) - FIXED
app.post('/api/afk-heartbeat', async (req, res) => {
//  console.log('[AFK Debug] Heartbeat received from user:', req.session.userinfo ? req.session.userinfo.id : 'unknown');
  
  // Authentication: Require logged-in user via session
  if (!req.session.userinfo) {
    console.log('[AFK Debug] Unauthorized heartbeat - no session');
    return res.status(401).json({ error: 'Unauthorized - must be logged in' });
  }
  const userId = req.session.userinfo.id;
  const { afkSession, elapsedSinceStart } = req.body;  // elapsed is client-reported but not trusted

  if (!afkSession) {
    console.log('[AFK Debug] Invalid session in heartbeat');
    return res.status(400).json({ error: 'Invalid session' });
  }

  try {
    const sessionKey = `afk_session_${userId}`;
    const coinsKey = `coins-${userId}`;  // Matches your existing coin key format (e.g., "coins-123")
    
    // Get session data from DB (do NOT update yet)
    let sessionData = await db.get(sessionKey);
    const now = Date.now();
    
    if (!sessionData) {
      // New session: No previous time, so timeSinceLast = 0 (no award, just init)
      console.log(`[AFK Debug] New AFK session for user ${userId} - initializing`);
      sessionData = {
        startTime: now,
        lastHeartbeat: now,  // Set to now for future calcs
        totalEarnedInSession: 0
      };
      const timeSinceLast = 0;  // Explicitly 0 for new sessions
      await db.set(sessionKey, sessionData);  // Save immediately
      console.log(`[AFK Debug] New session created. timeSinceLast: ${timeSinceLast}s`);
      return res.json({ 
        success: true, 
        earnedThisHeartbeat: 0, 
        message: 'New session started' 
      });
    } else {
      // Existing session: Calculate using OLD lastHeartbeat
      const oldLastHeartbeat = sessionData.lastHeartbeat;
      const timeSinceLast = (now - oldLastHeartbeat) / 1000;  // Seconds since LAST heartbeat
      
      // Now update lastHeartbeat to current time (for next calc)
      sessionData.lastHeartbeat = now;
      await db.set(sessionKey, sessionData);  // Save updated session
      
    //  console.log(`[AFK Debug] Existing session for user ${userId}. Old last: ${oldLastHeartbeat}, Now: ${now}, timeSinceLast: ${timeSinceLast}s`);
      
      const minInterval = 20;  // Min time between heartbeats (to prevent spam; < HEARTBEAT_INTERVAL=30s)
      
      if (timeSinceLast < minInterval) {
        // Too frequent - ignore to prevent abuse
        console.log(`[AFK Debug] Heartbeat too soon - ignoring (time: ${timeSinceLast}s < ${minInterval}s)`);
        return res.json({ success: true, earnedThisHeartbeat: 0, message: 'Heartbeat too soon' });
      }
      
      // Get AFK settings (fallback if not enabled)
      const afkSettings = settings.api && settings.api.arcio && settings.api.arcio["afk page"] ? settings.api.arcio["afk page"] : null;
      if (!afkSettings || !settings.api.arcio.enabled) {
        console.log('[AFK Debug] AFK not enabled in settings - no awards');
        return res.json({ success: true, earnedThisHeartbeat: 0, message: 'AFK disabled' });
      }
      
      const afkInterval = afkSettings.every || 10;
      const coinsPerInterval = afkSettings.coins || 1;
      
      // Calculate coins to award: Proportional to time elapsed (full award every afkInterval seconds)
      // E.g., if 30s heartbeat and afkInterval=10s, award 3x coins (but cap if needed)
      const coinsPerSecond = coinsPerInterval / afkInterval;  // e.g., 1 coin / 10s = 0.1/sec
      let earnedThisHeartbeat = Math.floor(coinsPerSecond * timeSinceLast);
      
      // Cap: Don't award more than, say, 2x full interval per heartbeat
      const maxPerHeartbeat = coinsPerInterval * 2;
      earnedThisHeartbeat = Math.min(earnedThisHeartbeat, maxPerHeartbeat);
      
      // console.log(`[AFK Debug] Calculated award: ${earnedThisHeartbeat} coins (interval: ${afkInterval}s, per sec: ${coinsPerSecond}, time: ${timeSinceLast}s)`);
      
      if (earnedThisHeartbeat > 0) {
        // Get current coins (matches your renderdataeval format)
        let currentCoins = await db.get(coinsKey) || 0;
        if (typeof currentCoins !== 'number') currentCoins = 0;
        
        // Award and save (direct write via Keyv to SQLite)
        const newCoins = currentCoins + earnedThisHeartbeat;
        await db.set(coinsKey, newCoins);
        
        // Update session total
        sessionData.totalEarnedInSession += earnedThisHeartbeat;
        await db.set(sessionKey, sessionData);  // Re-save with updated total
        
      //  console.log(`[AFK] Awarded ${earnedThisHeartbeat} coins to user ${userId} | Old: ${currentCoins} | New: ${newCoins} | Session total: ${sessionData.totalEarnedInSession}`);
      } else {
        console.log('[AFK Debug] No coins awarded this heartbeat (0 calculated)');
      }
      setTimeout(async () => {
        const currentSession = await db.get(sessionKey);
        if (currentSession && (Date.now() - currentSession.lastHeartbeat > 300000)) {
          await db.delete(sessionKey);
          console.log(`[AFK] Expired inactive session for user ${userId}`);
        }
      }, 300000);
      
      res.json({
        success: true,
        earnedThisHeartbeat,
        newBalance: await db.get(coinsKey) || 0,
        message: 'Session active'
      });
    }
    
  } catch (err) {
    console.error('[AFK] Heartbeat error:', err);
    res.status(500).json({ error: 'Failed to process heartbeat' });
  }
});



app.all("*", async (req, res) => {
  if (req.session.pterodactyl) if (req.session.pterodactyl.id !== await db.get("users-" + req.session.userinfo.id)) return res.redirect("/login?prompt=none");
  let theme = indexjs.get(req);
let newsettings = JSON.parse(require("fs").readFileSync("./settings.json"));
if (newsettings.api.arcio.enabled == true) req.session.arcsessiontoken = Math.random().toString(36).substring(2, 15);
  if (theme.settings.mustbeloggedin.includes(req._parsedUrl.pathname)) if (!req.session.userinfo || !req.session.pterodactyl) return res.redirect("/login" + (req._parsedUrl.pathname.slice(0, 1) == "/" ? "?redirect=" + req._parsedUrl.pathname.slice(1) : ""));
  if (theme.settings.mustbeadmin.includes(req._parsedUrl.pathname)) {
    ejs.renderFile(
      `./themes/${theme.name}/${theme.settings.notfound}`, 
      await eval(indexjs.renderdataeval),
      null,
    async function (err, str) {
      delete req.session.newaccount;
      delete req.session.password;
      if (!req.session.userinfo || !req.session.pterodactyl) {
        if (err) {
          console.log(chalk.red(`[WEBSITE] An error has occured on path ${req._parsedUrl.pathname}:`));
          console.log(err);
          return res.send("An error has occured while attempting to load this page. Please contact an administrator to fix this.");
        };
        res.status(200);
        return res.send(str);
      };

      let cacheaccount = await fetch(
        settings.pterodactyl.domain + "/api/application/users/" + (await db.get("users-" + req.session.userinfo.id)) + "?include=servers",
        {
          method: "get",
          headers: { 'Content-Type': 'application/json', "Authorization": `Bearer ${settings.pterodactyl.key}` }
        }
      );
      if (await cacheaccount.statusText == "Not Found") {
        if (err) {
          console.log(chalk.red(`[WEBSITE] An error has occured on path ${req._parsedUrl.pathname}:`));
          console.log(err);
          return res.send("An error has occured while attempting to load this page. Please contact an administrator to fix this.");
        };
        return res.send(str);
      };
      let cacheaccountinfo = JSON.parse(await cacheaccount.text());
    
      req.session.pterodactyl = cacheaccountinfo.attributes;
      if (cacheaccountinfo.attributes.root_admin !== true) {
        if (err) {
          console.log(chalk.red(`[WEBSITE] An error has occured on path ${req._parsedUrl.pathname}:`));
          console.log(err);
          return res.send("An error has occured while attempting to load this page. Please contact an administrator to fix this.");
        };
        return res.send(str);
      };

      ejs.renderFile(
        `./themes/${theme.name}/${theme.settings.pages[req._parsedUrl.pathname.slice(1)] ? theme.settings.pages[req._parsedUrl.pathname.slice(1)] : theme.settings.notfound}`, 
        await eval(indexjs.renderdataeval),
        null,
      function (err, str) {
        delete req.session.newaccount;
        delete req.session.password;
        if (err) {
          console.log(`[WEBSITE] An error has occured on path ${req._parsedUrl.pathname}:`);
          console.log(err);
          return res.send("An error has occured while attempting to load this page. Please contact an administrator to fix this.");
        };
        res.status(200);
        res.send(str);
      });
    });
    return;
  };
    const data = await eval(indexjs.renderdataeval)
  ejs.renderFile(
    `./themes/${theme.name}/${theme.settings.pages[req._parsedUrl.pathname.slice(1)] ? theme.settings.pages[req._parsedUrl.pathname.slice(1)] : theme.settings.notfound}`, 
    data,
    null,
  function (err, str) {
    delete req.session.newaccount;
    delete req.session.password;
    if (err) {
      console.log(chalk.red(`[WEBSITE] An error has occured on path ${req._parsedUrl.pathname}:`));
      console.log(err);
      return res.send("An error has occured while attempting to load this page. Please contact an administrator to fix this.");
    };
    res.status(200);
    res.send(str);
  });
});

module.exports.get = function(req) {
  let defaulttheme = JSON.parse(fs.readFileSync("./settings.json")).defaulttheme;
  let tname = encodeURIComponent(getCookie(req, "theme"));
  let name = (
    tname ?
      fs.existsSync(`./themes/${tname}`) ?
        tname
      : defaulttheme
    : defaulttheme
  )
  return {
    settings: (
      fs.existsSync(`./themes/${name}/pages.json`) ?
        JSON.parse(fs.readFileSync(`./themes/${name}/pages.json`).toString())
      : defaultthemesettings
    ),
    name: name
  };
};

module.exports.islimited = async function() {
  return cache == true ? false : true;
}

module.exports.ratelimits = async function(length) {
  if (cache == true) return setTimeout(
    indexjs.ratelimits
    , 1
  );
  cache = true;
  setTimeout(
    async function() {
      cache = false;
    }, length * 1000
  )
}

// Get a cookie.
function getCookie(req, cname) {
  let cookies = req.headers.cookie;
  if (!cookies) return null;
  let name = cname + "=";
  let ca = cookies.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == ' ') {
      c = c.substring(1);
    }
    if (c.indexOf(name) == 0) {
      return decodeURIComponent(c.substring(name.length, c.length));
    }
  }
  return "";
}
