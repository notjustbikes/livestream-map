const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./config.js");
const geoTz = require("geo-tz");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

let lastRequest = {
  city: "",
  city2: "",
  town: "",
  town2: "",
  street: "",
  district: "",
  state: "",
  zipcode: "",
  county: "",
  country: "",
  country2: "",
  temp: "",
  time: "",
  direction: "",
  gapi: config.GOOGLEAPI,
};

let lastServiceExecution = {
  weather: 0,
  here: 0
};

let lastLogUpdate = Date.now();

setInterval(() => {
  const now = Date.now();

  if (now - lastLogUpdate >= config.STALE_DATA_TIMEOUT) {
    if (lastRequest.s || lastRequest.temp || lastRequest.street || lastRequest.city) {
//    Don't remove the weather as this is probably still valid and it doesn't re-update often
//    lastRequest.temp = "";
//    lastRequest.icon = "";
      lastRequest.s = "";
      lastRequest.street = "";
      lastRequest.city = "";
      lastRequest.state = "";
      lastRequest.zipcode = "";
      logger.info("Cleared stale data due to inactivity.");
      io.emit("locationUpdate", lastRequest);
    }
  }
}, 60000); // Runs every 60 seconds

// Ignore favicon.ico requests
app.get('/favicon.ico', (req, res) => res.sendStatus(204));

app.use("/images", express.static(__dirname + "/images"));

app.use((req, res, next) => {
  const ip = req.header("x-forwarded-for") || req.connection.remoteAddress;
  const whitelist = ["::ffff:127.0.0.1", "127.0.0.1", "localhost", "::1"];
  if (whitelist.includes(ip) || req.query.key === config.UNIQUE_CODE) {
    next();
  } else {
    logger.warn(`ACCESS DENIED - IP: ${ip} - Missing or invalid key.`);
    res.sendStatus(401);
  }
});

app.get("/street", (req, res) => res.sendFile(__dirname + "/street.html"));
app.get("/map", (req, res) => res.sendFile(__dirname + "/map.html"));
app.get("/weather", (req, res) => res.sendFile(__dirname + "/weather.html"));
app.get("/speed", (req, res) => res.sendFile(__dirname + "/speed.html"));

// always refresh the weather on load/reload to ensure it's correct
app.get("/force-weather", async (req, res) => {
  if (!lastRequest.lat || !lastRequest.lon) {
    return res.status(400).send("No location available");
  }

  logger.info("Forced OpenWeatherMap update requested via /force-weather");
  await getOpenWeatherMap(lastRequest.lat, lastRequest.lon);
  res.sendStatus(200);
});

// provide the map style for the Google Maps API
app.get("/style", (req, res) => {
  res.sendFile(__dirname + `/map_styles/${config.MAPSTYLE}.json`);
});

// cut-down list of stats that the frontend can requets
app.get("/stats/:key", (req, res) => {
  const allowedKeys = ["gapi", "temp", "city", "state"];
  if (allowedKeys.includes(req.params.key)) {
    return res.send(`${lastRequest[req.params.key] || ""}`);
  }
  res.sendStatus(404);
});

// location update endpoint hit by the GPS app GPSLogger (https://gpslogger.app/)
app.get("/log", async (req, res) => {
  delete req.query.key;

  if (req.query.a) req.query.a = `${Math.round(req.query.a)} m`;
  // If speed is provided, format it; if not, clear the stored speed.
  if (req.query.hasOwnProperty("s")) {
    req.query.s = `${Math.floor(req.query.s)} km/h`;
  } else {
    // No speed provided in this update—clear it
    lastRequest.s = "";
  }
  // battery level
  if (req.query.b) req.query.b = `${Math.round(req.query.b)}%`;

  Object.assign(lastRequest, req.query);

  if (req.query.lat && req.query.lon) {
    const { lat, lon } = req.query;
    lastRequest.time = new Date().toLocaleTimeString("en-US", {
      timeZone: geoTz.find(lat, lon)[0],
      hour: "2-digit",
      minute: "2-digit",
    });

    logger.info(`LOG RECEIVED - lat: ${lat}, lon: ${lon}`);
    await triggerServiceFetches(lat, lon);
    // Update last log timestamp
    lastLogUpdate = Date.now();

    io.emit("locationUpdate", lastRequest);
  }

  io.emit("rawData", req.query);
  res.sendStatus(200);
});

io.on("connection", (socket) => {
  logger.info("New client connected - sending initial data.");
  io.emit("locationUpdate", lastRequest);
});

// fetch geocoded location and weather data with rate limiting
async function triggerServiceFetches(lat, lon) {
  const now = Date.now();
  const promises = [];
  if (now - lastServiceExecution.weather >= config.RATELIMIT_WEATHER) {
    lastServiceExecution.weather = now;
    promises.push(getOpenWeatherMap(lat, lon));
  }
  if (now - lastServiceExecution.here >= config.RATELIMIT_HERE) {
    lastServiceExecution.here = now;
    promises.push(getHEREdotcom(lat, lon));
  }
  await Promise.all(promises);
}

// friendly display for wind direction
function degToCompass(num) {
  const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "S", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return arr[Math.floor(num / 22.5 + 0.5) % 16];
}

// get weather from OpenWeatherMap.org
async function getOpenWeatherMap(lat, lon) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${config.UNITS}&appid=${config.OWM_Key}`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`OpenWeatherMap HTTP error! status: ${res.status}`);

    const data = await res.json();
    const icon = data.weather[0].icon;

    lastRequest.icon = `http://openweathermap.org/img/wn/${icon}@2x.png`;
    lastRequest.direction = degToCompass(data.wind.deg);
    lastRequest.temp = Math.floor(data.main.temp);
    logger.info(`OpenWeatherMap API updated weather data.`);
  } catch (err) {
    logger.error(`OpenWeatherMap API call failed: ${err}`);
  }
}

// get geocoded location data from HERE.com
async function getHEREdotcom(lat, lon) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(
      `https://revgeocode.search.hereapi.com/v1/revgeocode?at=${lat}%2C${lon}&lang=en-US&app_id=${config.HERE_appid}&apikey=${config.HERE_apikey}`,
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HERE.com HTTP error! status: ${res.status}`);

    const data = await res.json();
    const addr = data.items[0].address || {};

    lastRequest = {
      ...lastRequest,
      city: addr.city || "",
      town: addr.city || "",
      zipcode: addr.postalCode || "",
      state: addr.stateCode || "",
      street: addr.street || "",
      county: addr.county || "",
      district: addr.district || "",
      label: addr.label || "",
      countrycode: addr.countryCode || "",
    };
    logger.info(`HERE.com API updated location data.`);
  } catch (err) {
    logger.error(`HERE.com API call failed: ${err}`);
  }
}

server.listen(config.PORT, () => logger.info(`Server listening on port ${config.PORT}`));
