import multer from 'multer'
import moment from 'moment'
import xml2js from 'xml2js'

import { authenticator } from '../auth'
import { haversine, staticMap } from '../helpers'
import { RIDES_DB } from '../design_docs/rides'

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
      const name = `${
        distance.toFixed(2)
        } mi ride on ${
        moment(startTime).format('MMMM DD YYYY')
        }`


      const rideID = `${resp.locals.userID}_${(new Date).getTime().toString()}`
      const ride = {
        _id: rideID,
        coverPhotoID: null,
        distance,
        elapsedTimeSecs: (lastTime - startTime) / 1000,
        name,
        rideCoordinates: parsedPoints,
        photosByID: {},
        startTime,
        type: 'ride',
        userID: resp.locals.userID,
      }
      ride.mapURL = staticMap(ride)
      console.log(ride.mapURL)
      slouch.doc.create(RIDES_DB, ride)
    })
    return resp.json({})
  })
}

