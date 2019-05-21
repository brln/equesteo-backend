import murmur from 'murmurhash-js'
import fetch from 'node-fetch'

import Logging from './Logging'
import S3Service from './s3'
import {
  configGet,
  MAPBOX_TOKEN,
} from "../config"

export default class RideMap {
  static s3URL (decodedURL, error) {
    if (!decodedURL.startsWith('https://api.mapbox.com/styles/v1/equesteo/')) {
      error()
    }
    return `${murmur.murmur3(decodedURL, 'equesteo-map-url')}.png`
  }

  static getOrFetch (decoded, error, success) {
    const hashKey = RideMap.s3URL(decoded, error)
    const BUCKET_NAME = 'equesteo-ride-maps'
    const s3Service = new S3Service()
    let found = false
    let fromMapbox
    return s3Service.get(BUCKET_NAME, hashKey).then(data => {
      found = true
      return data.Body
    }).catch(() => { Logging.log(`${hashKey} not found`)}).then(data => {
      if (found) {
        return data
      } else {
        return fetch(decoded + `?access_token=${configGet(MAPBOX_TOKEN)}`).then(resp => {
          Logging.log('fetching from mapbox')
          return resp.buffer()
        }).then(data => {
          Logging.log('reading mapbox buffer')
          fromMapbox = data
          return data
        })
      }
    }).then(imageData => {
      success(imageData, hashKey)
    }).then(() => {
      if (!found) {
        return s3Service.put(BUCKET_NAME, hashKey, fromMapbox).then(() => {
          Logging.log(`cached ${hashKey}`)
        }).catch(e => {
          Logging.log(e)
        })
      }
    })
  }
}