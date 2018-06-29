import proxy from 'express-http-proxy'

import { authenticator } from '../auth'
import { configGet, COUCH_HOST, COUCH_USERNAME, COUCH_PASSWORD } from '../config'

export function couchProxy (app) {
  app.use('/couchproxy', authenticator, proxy(`http://${configGet(COUCH_HOST)}`, {
    limit: "50mb",
    proxyReqBodyDecorator: function(bodyContent, srcReq) {
      // console.log(bodyContent.toString())
      return bodyContent
    },
    proxyReqOptDecorator: async (proxyReqOpts, srcReq) => {
      proxyReqOpts.headers['Authorization'] = 'Basic ' +
        Buffer.from(
          `${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}`
        ).toString('base64')
      return proxyReqOpts
    },
    proxyErrorHandler: function(err, res, next) {
      console.log(err)
      next(err);
    }
  }))
}