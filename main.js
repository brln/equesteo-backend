import aws from 'aws-sdk'
import murmur from 'murmurhash-js'
import express from 'express'
import fetch from 'node-fetch'
import gcm from 'node-gcm'
import logger from 'morgan'
import Slouch from 'couch-slouch'
import elasticsearch from 'elasticsearch'
import * as Sentry from '@sentry/node'

import { authenticator } from './auth'
import {
  configGet,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  ELASTICSEARCH_HOST,
  GCM_API_KEY,
  LOGGING_TYPE,
  MAPBOX_TOKEN,
  NODE_ENV,
} from "./config"
import { couchProxyRouter, photosRouter, sharableRouter, usersRouter } from './controllers'
import { createUsersDesignDoc, USERS_DB } from "./design_docs/users"
import { createHorsesDesignDoc, HORSES_DB } from "./design_docs/horses"
import { createRidesDesignDoc, RIDES_DB } from './design_docs/rides'

import startRideChangeIterator from './ChangeIterators/rides'
import startUsersChangeIterator from './ChangeIterators/users'
import DynamoDBService from './services/dynamoDB'
import S3Service from './services/s3'

const app = express()
app.use(logger(configGet(LOGGING_TYPE)))

if (configGet(NODE_ENV) !== 'local') {
  Sentry.init({dsn: 'https://04b0f2944b3d43af8fc7d039a8bb6359@sentry.io/1305626'})
  app.use(Sentry.Handlers.requestHandler())
}

aws.config.update({
  secretAccessKey: configGet(AWS_SECRET_ACCESS_KEY),
  accessKeyId: configGet(AWS_ACCESS_KEY_ID),
  region: 'us-west-1'
});

app.use(express.static('static'))

const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);
createUsersDesignDoc(slouch)
createHorsesDesignDoc(slouch)
createRidesDesignDoc(slouch)

// Create endpoints
app.use('/couchProxy', couchProxyRouter)
app.use('/users', usersRouter)
app.use('', photosRouter)
app.use('', sharableRouter)

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const gcmClient = new gcm.Sender(configGet(GCM_API_KEY));

const ddbService = new DynamoDBService()

startUsersChangeIterator(ESClient, slouch)
startRideChangeIterator(slouch, gcmClient, ddbService)

app.get('/', (req, res) => {
  res.redirect('https://equesteo.com')
})

app.get('/errorTest', (req, res) => {
  throw new Error('Broke!');
});

app.get('/unauthorizedTest', (req, res) => {
  console.log('unauthorized test')
  return res.status(401).json({error: 'Invalid Authorization header'})
})

app.get('/checkAuth', authenticator, (req, res) => {
  return res.json({})
})


app.get('/rideMap/:url', (req, res, next) => {
  const decoded = new Buffer(req.params.url, 'base64').toString('ascii')
  if (!decoded.startsWith('https://api.mapbox.com/styles/v1/equesteo/')) {
    return res.sendStatus(400)
  }

  const hashKey = `${murmur.murmur3(decoded, 'equesteo-map-url')}.png`

  const BUCKET_NAME = 'equesteo-ride-maps'
  const s3Service = new S3Service()
  let found = false
  let fromMapbox
  s3Service.get(BUCKET_NAME, hashKey).then(data => {
    found = true
    return data.Body
  }).catch(() => { console.log(`${hashKey} not found`)}).then(data => {
    if (found) {
      return data
    } else {
      return fetch(decoded + `?access_token=${configGet(MAPBOX_TOKEN)}`).then(resp => {
        console.log('fetching from mapbox')
        return resp.buffer()
      }).then(data => {
        console.log('reading mapbox buffer')
        fromMapbox = data
        return data
      })
    }
  }).then(imageData => {
    res.setHeader("content-type", "image/png")
    return res.send(imageData)
  }).then(() => {
    if (!found) {
      return s3Service.put(BUCKET_NAME, hashKey, fromMapbox).then(() => {
        console.log(`cached ${hashKey}`)
      }).catch(e => {
        console.log(e)
      })
    }
  })
})

app.get('/replicateProd', async (req, res) => {
  if (configGet(NODE_ENV) !== 'local') {
    return res.json({'not for': "you"})
  }
  console.log('destroying local DBs')
  try {
    const destroys = [
      slouch.db.destroy(RIDES_DB),
      slouch.db.destroy(USERS_DB),
      slouch.db.destroy(HORSES_DB),
    ]
    try {
      await Promise.all(destroys)
    } catch (e) {
      if (e.error !== 'not_found') {
        throw e
      }
    }

    console.log('recreating local dbs')
    const creates =[
      slouch.db.create(RIDES_DB),
      slouch.db.create(USERS_DB),
      slouch.db.create(HORSES_DB),
    ]
    try {
      await Promise.all(creates)
    } catch (e) {
      console.log('wtf')
      throw e
    }

    const prodCouch = `http://equesteo:${process.env.PROD_COUCH_PASSWORD}@52.9.138.254:5984/`
    const dbs = ['horses', 'rides', 'users']

    const replications = []
    for (let db of dbs) {
      console.log(`starting replication on ${db}`)
      replications.push(slouch.db.replicate({
        source: prodCouch + db,
        target: db
      }))
    }
    await Promise.all(replications)
    console.log('replications complete')

    const tableName = 'equesteo_users'
    const ddbService = new DynamoDBService()
    console.log('deleting dynamoDB users table')
    try{
      await ddbService.deleteTable(tableName)
    } catch (e) {
      console.log('skipping delete')
    }
    console.log('creating dynamoDB users table')
    await ddbService.createTable('email', 'S', tableName)

    const prodDDBService = new DynamoDBService('production')
    const allItems = await prodDDBService.getAllItems(tableName)
    const putPromises = []
    for (let item of allItems) {
      const putItem = {
        password: {S: '$2a$10$Ds3tCqSgH0J1RntA7YOJVOy5ts6Jvk1GTYlHtyWLNCd3aEf5RoMKa'},
        id: {S: item.id},
        email: {S: item.email},
        enabled: {BOOL: true},
        refreshToken: {NULL: true}
      }
      putPromises.push(ddbService.putItem(tableName, putItem))
    }
    await Promise.all(putPromises)
  }
  catch (e) {
    console.log(e)
    return res.json({'error': e.toString()})
  }
  return res.json({'done': "now"})
})

if (configGet(NODE_ENV) !== 'local') {
  app.use(Sentry.Handlers.errorHandler());
}

const errorHandler = (err, req, res, next) => {
  console.log(err);
  res.status(500).json({'error': '500 Internal Server Error'})
};

app.use(errorHandler)

app.use(function (req, res, next) {
  res.status(404).json({'error': '404 Not Found'})
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});

