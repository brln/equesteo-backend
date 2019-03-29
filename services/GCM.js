import gcm from 'node-gcm'

import { configGet, GCM_API_KEY } from "../config"
import Logging from './Logging'

export default class GCMService {
  constructor () {
    this.client = new gcm.Sender(configGet(GCM_API_KEY));
  }

  sendMessage (title, body, data, tokens) {
    if (tokens.android.length) {
      const androidMessage = new gcm.Message({
        data,
        priority: 'high',
        content_available: true,
      })
      this.client.send(
        androidMessage,
        {registrationTokens: tokens.android},
        (err, response) => {
          if (err) {
            Logging.log(err)
            Logging.log(response)
            throw err
          } else {
            Logging.log('Android send response: ============')
            Logging.log(response);
          }
        }
      )
    }

    if (tokens.ios.length) {
      const iosMessage = new gcm.Message({
        data,
        priority: 'high',
        content_available: true,
      })

      this.client.send(
        iosMessage,
        {registrationTokens: tokens.ios},
        (err, response) => {
          if (err) {
            Logging.log(err)
            Logging.log(response)
            throw err
          } else {
            Logging.log('iOS message send response: ============')
            Logging.log(response);
          }
        }
      )

      const iosNotification = new gcm.Message({
        notification: {
          title,
          body,
        },
        data,
        priority: 'high',
        content_available: true,
      })

      this.client.send(
        iosNotification,
        {registrationTokens: tokens.ios},
        (err, response) => {
          if (err) {
            Logging.log(err)
            Logging.log(response)
            throw err
          } else {
            Logging.log('iOS notification send response: ============')
            Logging.log(response);
          }
        }
      )
    }
  }
}