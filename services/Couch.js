import request from 'request'
import querystring from 'querystring'
import { configGet, USER_COUCHDB_PASSWORD } from "../config"

const GET = 'get'
const POST = 'post'
const PUT = 'put'

export default class CouchService {
  constructor (username, password, host) {
    this.username = username
    this.password = password
    this.host = host

    this.root = `http://${this.username}:${this.password}@${this.host}`
  }

  getInfo () {
    return request(this.root)
  }

  getDBInfo (db) {
    return this.request(GET, `/${db}/`)
  }

  getLocalDoc (db, id, qs) {
    return this.request(GET, `/${db}/_local/${id}`, qs)
  }

  putLocalDoc (db, id, qs) {
    return this.request(PUT, `/${db}/_local/${id}`, qs)
  }

  getRevDiffs (db, qs) {
    return this.request(GET, `/${db}/_revs_diff`, qs)
  }

  postRevDiffs (db, qs) {
    return this.request(POST, `/${db}/_revs_diff`, qs)
  }

  getView (db, designDoc, view, qs) {
    return this.request(GET, `/${db}/_design/${designDoc}/_view/${view}`, qs)
  }

  postView (db, designDoc, view, qs) {
    return this.request(POST, `/${db}/_design/${designDoc}/_view/${view}`, qs)
  }

  postChanges (db, qs) {
    return this.request(POST, `/${db}/_changes`, qs)
  }

  getChanges (db, qs) {
    return this.request(GET, `/${db}/_changes`, qs)
  }

  postAllDocs (db, qs) {
    return this.request(POST, `/${db}/_all_docs`, qs)
  }

  postBulkDocs (db, qs) {
    return this.request(POST, `/${db}/_bulk_docs`, qs)
  }

  postBulkGet (db, qs) {
    return this.request(POST, `/${db}/_bulk_get`, qs)
  }

  getItem (db, id, qs) {
    return this.request(GET, `/${db}/${id}`, qs)
  }


  getLeaderboardOptOutUsers() {
    const url = `/users/_design/users/_view/leaderboardOptOuts`
    return this.request(GET, url, {}, false)
  }

  getAllRides(ids=[]) {
    const url = `/rides/_design/rides/_view/rideData`
    if (ids.length > 0) {
      return this.request(POST, url, {include_docs: true}, false, {keys: ids})
    } else {
      return this.request(GET, url, {include_docs: true}, false)
    }
  }

  createUser (id) {
    const url = `/_users/org.couchdb.user:${id}`
    return this.request(PUT, url, {}, false, {"name": id, "password": configGet(USER_COUCHDB_PASSWORD), "roles": ["equesteoUser"], "type": "user"})
  }

  getUser (id) {
    const url = `/_users/org.couchdb.user:${id}`
    return this.request(GET, url, {}, false).catch()
  }

  request (method, endpoint, qs={}, asStream=true, body=null) {
    let uri = `${this.root}${endpoint}`
    if (Object.keys(qs).length > 0) {
      uri = uri +  `?${querystring.stringify(qs)}`
    }
    if (asStream) {
      return request({
        method,
        uri,
        forever: true,
      })
    } else {
      return new Promise((res, rej) => {
        const opts = {
          method,
          uri,
          forever: true,
        }
        if ((method === POST || method === PUT) && body) {
          opts.json = body
        }
        request(opts, (err, response, respBody) => {
          if (err) {
            rej(err)
          } else {
            if (body) {
              res(respBody)
            } else {
              res(JSON.parse(respBody))
            }
          }
        })
      })
    }
  }
}
