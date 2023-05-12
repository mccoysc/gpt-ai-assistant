import express from 'express';
import { handleEvents, printPrompts } from '../app/index.js';
import config from '../config/index.js';
import { validateLineSignature } from '../middleware/index.js';
import storage from '../storage/index.js';
import { fetchVersion, getVersion } from '../utils/index.js';
import * as mqtt from "mqtt"
import * as http from "http"

async function* streamAsyncIterable(stream) {
  if (!stream.getReader) {
    var shouldLoop = true;
    while (shouldLoop) {
      yield (new Promise(function (resolve, reject) {
        stream.on("data", (chunk) => {
          resolve(chunk);
        });
        stream.on("end", () => {
          shouldLoop = false;
          resolve();
        });
        stream.on("error", (err) => {
          shouldLoop = false;
          reject(err);
        });
      }));
    }
    return;
  } else {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    if(!buf?.length){
      res.statusCode=400;
      return res.end("invalid body");
    }
    req.rawBody = buf.toString();
  },
}));

app.get('/', (req, res) => {
  if (config.APP_URL) {
    res.redirect(config.APP_URL);
    return;
  }
  res.sendStatus(200);
});

app.get('/info', async (req, res) => {
  const currentVersion = getVersion();
  const latestVersion = await fetchVersion();
  res.status(200).send({ currentVersion, latestVersion });
});

app.post(config.APP_WEBHOOK_PATH, validateLineSignature, async (req, res) => {
  if(!req.body?.events){
    res.statusCode=400;
    return res.end("invalid body");
  }
  try {
    await storage.initialize();
    await handleEvents(req.body.events);
    res.sendStatus(200);
  } catch (err) {
    console.error(err.message);
    res.sendStatus(500);
  }
  if (config.APP_DEBUG) printPrompts();
});

if (config.APP_PORT) {
  http.createServer(app).listen(config.APP_PORT, async function () {
    const mqttEndpoint = process.env.MQ_ENDPOINT || "mqtt://test.mosquitto.org";
    const mqttTopic = process.env.MQ_TOPIC || "MQ_ON_HTTTP_REQUEST";
    var mqttClient = mqtt.connect(mqttEndpoint);
    try {
      await (new Promise(function (resolver) {
        mqttClient.once("connect", function () {
          return resolver(true);
        });
      }));
    } catch (error) {
      throw new Error("connect mqtt endpoint error");
    }

    mqttClient.subscribe(mqttTopic);
    mqttClient.on("message", async function (topic, payload) {
      if (!payload || !payload.length) {
        return;
      }
      try {
        payload = JSON.parse(Buffer.from(payload).toString());
      } catch (error) {
        console.log("invalid mqtt msg:",Buffer.from(payload).toString());
      }
      if (!payload.httpHeaders || !payload.replyTopic) {
        if (payload.replyTopic) {
          mqttClient.publish(payload.replyTopic, JSON.stringify({
            statusCode: 400,
            httpHeaders: {},
            httpBodyEncodeType: "base64",
            httpBody: Buffer.from("invalid msg data").toString("base64")
          }));
        }
        return;
      }
      if (!payload.httpPath) {
        payload.httpPath = "/";
      }
      if (!payload.httpMethod) {
        payload.httpMethod = "POST";
      }
      if (payload.httpMethod.toUpperCase() === "POST" && payload.httpBodyEncodeType) {
        if (payload.httpBodyEncodeType) {
          if (payload.httpBodyEncodeType === "URIComponent") {
            payload.httpBody = Buffer.from(decodeURIComponent(payload.httpBody));
          } else {
            payload.httpBody = Buffer.from(payload.httpBody, payload.httpBodyEncodeType);
          }
        } else {
          payload.httpBody = Buffer.from(payload.body);
        }
      }
      const fetchOpts={
        method: payload.httpMethod.toUpperCase(),
        headers: payload.httpHeaders,
      };
      delete fetchOpts.headers["connection"];
      delete fetchOpts.headers["Connection"];
      if(payload.httpBody){
        fetchOpts.body=Uint8Array.from(payload.httpBody)
      }
      var httpResponse = await fetch(`http://127.0.0.1:${config.APP_PORT}${payload.httpPath}`,fetchOpts);
      if (!payload.replyTopic) {
        if (httpResponse.status / 1 !== 200) {
          console.log("http response with statusCode " + res.statusCode + " in mqtt on message handler");
        }
        return;
      }
      const chunks = [];
      for await (var chunk of streamAsyncIterable(httpResponse.body)) {
        chunks.push(chunk);
      }
      var headers={};
      for (var header of (new Map(httpResponse.headers))) {
        headers=Object.assign(headers,header);
      }
      var resData = Buffer.concat(chunks).toString("base64");
      mqttClient.publish(payload.replyTopic, JSON.stringify({
        statusCode: httpResponse.status / 1,
        httpHeaders: headers,
        httpBodyEncodeType: "base64",
        httpBody: resData
      }));
    });
  });
}

export default app;