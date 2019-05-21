import request from 'request'

import RideMap from './RideMap'

export default class SlackService {
  static newSignup (email) {
    return SlackService.request(
      'https://hooks.slack.com/services/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',
      `Email: ${email}`
    )
  }

  static newFeedback (id, email, feedback) {
    return SlackService.request(
      'https://hooks.slack.com/services/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',
      `ID: ${id}\nEmail: ${email}\n=========================\n${feedback}\n==========================`
    )
  }

  static newRide (rideURL, startTime, name, userName, distance, time) {
    const encodedURL = new Buffer(rideURL).toString("base64")
    const uri = `https://api.equesteo.com/rideMap/${encodedURL}`
    const message = {
      "attachments": [
          {
              "color": "#36a64f",
              "pretext": name,
              "author_name": userName,
              "fields": [
                  {
                      "title": "Distance",
                      "value": distance,
                      "short": true
                  },
                  {
                    "title": "Time",
                    "value": time,
                    "short": false
                  }
              ],
              "image_url": uri,
              "ts": startTime / 1000
          }
      ]
    }


    return SlackService.request(
      'https://hooks.slack.com/services/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',
      null,
      message
    )
  }

  static request (webhook, text, formatted) {
    if (!formatted) {
      formatted = {text}
    }
    const opts = {
      method: 'POST',
      uri: webhook,
      json: formatted,
    }

    return new Promise((res, rej) => {
      request(opts, (err, response, respBody) => {
        console.log(respBody)
        if (err) {
          rej(err)
        } else {
          res(respBody)
        }
      })
    })
  }
}
