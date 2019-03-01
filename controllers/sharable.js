import aws from 'aws-sdk'
import bodyParser from 'body-parser'
import express from 'express'
import fs from 'fs'
import moment from 'moment'
import murmur from 'murmurhash-js'
import mustache from 'mustache'
import path from 'path'
import pupeteer from 'puppeteer'

import { authenticator } from '../auth'
import { configGet, MAPBOX_TOKEN, OWN_URL } from "../config"
import {
  averageSpeed,
  haversine,
  speedGradient,
  timeToString
} from '../helpers'
import { S3Service } from '../services'

const s3 = new aws.S3()

const router = express.Router()
router.use(bodyParser.urlencoded({ extended: true }))

const IMAGE_BUCKET = 'equesteo-sharable-map-images'
const PAGE_BUCKET = 'equesteo-sharable-map-pages'

function shareLink (key) {
  return `${configGet(OWN_URL)}/sharableMap/${key}`
}

function createMapPage (rideName, imagePath, shareLink, key) {
  const template = fs.readFileSync(path.join(__dirname, '../views/publicSharableMap.mustache')).toString('ascii')
  const asHTML = mustache.render(template, {
    rideName,
    imagePath,
    shareLink,
  })
  const params = {
    Bucket: PAGE_BUCKET,
    Key: `${key}.html`,
    Body: Buffer.from(asHTML)
  }
  return new Promise ((res, rej) => {
    s3.upload(params, (s3Err, data) => {
      if (s3Err) {
        rej(s3Err)
      } else {
        res(data)
      }
    })
  })
}

function createMap (rideData, bucket, key, filename) {
  const template = fs.readFileSync(path.join(__dirname, '../views/sharableMap.mustache')).toString('ascii')
  const content = mustache.render(template, {
    avgSpeed: rideData.avgSpeed,
    distance: rideData.distance,
    featureCollection: rideData.featureCollection,
    mapboxToken: configGet(MAPBOX_TOKEN),
    rideTime: rideData.rideTime,
    startDate: rideData.startDate,
  })
  return pupeteer.launch({'args' : [ '--disable-web-security' ]}).then(browser => {
    return browser.newPage().then(page => {
      page.on('console', consoleObj => console.log(consoleObj.text()));
      return page.setViewport({height: 1080, width: 1080}).then(() => {
        return page.setContent(content)
      }).then(() => {
        return page.waitForSelector('#done', {timeout: 30000})
      }).then(() => {
        return page.screenshot({fullPage: true})
      }).then((imageBuffer) => {
        console.log('uploading')
        const params = {
          Bucket: bucket,
          Key: filename,
          Body: imageBuffer
        }
        return Promise.all([
          new Promise((res, rej) => {
            s3.upload(params, (s3Err, data) => {
              if (s3Err) {
                rej(s3Err)
              } else {
                res(data)
              }
            })
          }),
          browser.close(),
        ])
      }).then(([s3Data]) => {
        return {
          mapURL: s3Data.Location,
          shareLink: shareLink(key)
        }
      })
    })
  })
}

router.get('/sharableMap/:key', (req, res, next) => {
  const key = `${req.params.key}.html`
  const s3service = new S3Service()
  s3service.get(PAGE_BUCKET, key).then(s3Resp => {
    res.type('text/html')
    res.send(new Buffer(s3Resp.Body))
  }).catch(e => {
    console.log(e)
    res.send(404)
  })
})

router.post('/sharableMap', authenticator, bodyParser.json(), (req, res, next) => {
  const id = req.body.id
  const rev = req.body.rev
  const key = murmur.murmur3(id + rev, 'equesteo-sharable-map-url').toString()
  const filename = `${key}.png`
  const link = shareLink(key)

  const s3Service = new S3Service()
  let returnData
  s3Service.checkExists(IMAGE_BUCKET, filename).then(exists => {
    if (exists) {
      res.json({
        mapURL: `https://s3-us-west-1.amazonaws.com/${IMAGE_BUCKET}/${filename}`,
        shareLink: link
      })
    } else {
      const rideData = {
        featureCollection: JSON.stringify(mapCoordinates(req.body.rideCoordinates)),
        startDate: moment(req.body.startTime).format('M-D-YY'),
        distance: req.body.distance.toFixed(1),
        rideTime: timeToString(req.body.rideTime),
        avgSpeed: averageSpeed(req.body.rideTime, req.body.distance),
      }
      createMap(rideData, IMAGE_BUCKET, key, filename).then(_returnData => {
        returnData = _returnData
        const imagePath = `https://s3-us-west-1.amazonaws.com/${IMAGE_BUCKET}/${filename}`
        return createMapPage(req.body.name, imagePath, link, key)
      }).then(() => {
        res.json(returnData)
      }).catch(e => {
        next(e)
      })
    }
  })
})

function mapCoordinates (rideCoordinates) {
  const featureCollection = {
    type: "FeatureCollection",
    features: []
  }

  rideCoordinates.reduce((accum, coord) => {
    const c = parseRideCoordinate(coord)
    if (!accum.lastCoord) {
      accum.lastCoord = c
    } else {
      const timeDiff = ((c.timestamp - accum.lastCoord.timestamp) / 1000) / 60 / 60
      let distance = haversine(
        accum.lastCoord.latitude,
        accum.lastCoord.longitude,
        c.latitude,
        c.longitude
      )
      let speed = distance / timeDiff

      const feature = {
        type: 'Feature',
        properties: {
          stroke: speedGradient(speed),
        },
        geometry: {
          type: "LineString",
          coordinates: [
            [accum.lastCoord.longitude, accum.lastCoord.latitude],
            [c.longitude, c.latitude]
          ]
        }
      }
      accum.featureCollection.features.push(feature)
      accum.lastCoord = c
    }
    return accum
  }, {lastCoord: null, featureCollection})
  return featureCollection
}

export function parseRideCoordinate (fromDB) {
  return {
    latitude: fromDB[0],
    longitude: fromDB[1],
    timestamp: fromDB[2],
    accuracy: fromDB[3]
  }
}

module.exports = router
