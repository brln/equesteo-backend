import multer from 'multer'
import Slouch from 'couch-slouch'
import xml2js from 'xml2js'

import { authenticator } from '../auth'
import { haversine, newRideName, staticMap } from '../helpers'
import { RIDES_DB } from '../design_docs/rides'
import {
  configGet,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
} from "../config"


const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);

export function postRide (app) {
  const upload = multer({ storage: multer.memoryStorage() })
  app.post("/gpxUploader", authenticator, upload.single('file'), (req, resp) => {
    let fileBuffer = req.file.buffer
    xml2js.parseString(fileBuffer, (err, res) => {
      const points = res.gpx.trk[0].trkseg[0].trkpt
      const parsedPoints = []
      let distance = 0
      let lastPoint = null
      let startTime = null
      let lastTime = null
      for (let point of points) {
        const timestamp = Date.parse(point.time[0])
        if (!lastTime || timestamp > lastTime) {
          lastTime = timestamp
        }
        const lat = parseFloat(point.$.lat)
        const long = parseFloat(point.$.lon)
        startTime = startTime ? startTime : timestamp
        if (lastPoint) {
          distance += haversine(lastPoint.lat, lastPoint.long, lat, long)
        }
        lastPoint = { lat, long }
        parsedPoints.push({
          latitude: lat,
          longitude: long,
          accuracy: null,
          timestamp,
        })
      }

      const rideID = `${resp.locals.userID}_${(new Date).getTime().toString()}`
      const ride = {
        _id: rideID,
        coverPhotoID: null,
        distance,
        elapsedTimeSecs: (lastTime - startTime) / 1000,
        rideCoordinates: parsedPoints,
        photosByID: {},
        startTime,
        type: 'ride',
        userID: resp.locals.userID,
        isPublic: true,
      }
      ride.name = newRideName(ride)
      ride.mapURL = staticMap(ride)
      slouch.doc.create(RIDES_DB, ride)
    })
    return resp.json({})
  })
}

