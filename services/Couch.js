import fetch from 'node-fetch'

export default class CouchService {
  constructor (username, password, host) {
    this.username = username
    this.password = password
    this.host = host
  }

  root() {
    return `http://${this.username}:${this.password}@${this.host}`
  }

  getAllUsers(ids) {
    return this.request(`${this.root()}/users/_all_docs?include_docs=true&keys=${JSON.stringify(ids)}`)
  }

  getLeaderboardOptOutUsers() {
    return this.request(`${this.root()}/users/_design/users/_view/leaderboardOptOuts`)
  }

  getAllRides(ids=[]) {
    const url = `${this.root()}/rides/_design/rides/_view/rideData?include_docs=true`
    if (ids.length > 0) {
      return this.request(url, {
        headers: { 'Content-Type': 'application/json' },
        method: 'post',
        body: JSON.stringify({
          keys: ids
        })
      })
    } else {
      return this.request(url)
    }
  }

  createDatabase (name) {
    return this.request(`${this.root()}/${name}`, {method: 'put'})
  }

  deleteDatabase (name) {
    return this.request(`${this.root()}/${name}`, {method: 'delete'})
  }

  startReplication (dbName, sourceDB) {
    const url = `${this.root()}/_replicate`
    const opts = {
      method: 'post',
      body: JSON.stringify({
        source: sourceDB.root() + `/${dbName}`,
        target: this.root() + `/${dbName}`,
      }),
      headers: { 'Content-Type': 'application/json' }
    }
    return this.request(url, opts)
  }

  request (endpoint, opts={}) {
    return fetch(endpoint, opts).then(resp => {
      return resp.json()
    }).then(json => {
      return json
    })
  }
}
