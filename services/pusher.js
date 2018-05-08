import Pusher from 'pusher'

import {
  configGet,
  PUSHER_KEY,
  PUSHER_SECRET,
} from "../config"

export default class PusherService {
  constructor () {
    this.pusher = new Pusher({
      appId: '518050',
      key: configGet(PUSHER_KEY),
      secret: configGet(PUSHER_SECRET),
      cluster: 'us2',
      encrypted: true
    });
  }

  trigger (channel, message) {
    this.pusher.trigger(channel, 'pull-db', {
      "message": message
    });
  }

  async channelStatus (channelName) {
    return new Promise((resolve, reject) => {
      this.pusher.get({ path: `/channels/${channelName}`}, (err, req, res) => {
        if (res.statusCode === 200) {
          resolve(res)
        } else {
          reject(err)
        }
      })
    })
  }
}