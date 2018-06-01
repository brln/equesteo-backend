const API_URL = 'http://localhost:8080'


export default class ApiClient {
  DELETE = 'delete'
  GET = 'get'
  POST = 'post'
  PUT = 'put'

  constructor(token){
    this.token = token
  }

  headers (isJson) {
    let headers = {
     'Authorization': 'Bearer: ' + this.token,
    }
    if (isJson) {
      headers['Content-Type'] = 'application/json'
    }
    return new Headers(headers)
  }

  async delete (endpoint) {
    return this.request(this.DELETE, endpoint)
  }

  async get (endpoint) {
    return this.request(this.GET, endpoint)
  }

  async post (endpoint, body) {
    return this.request(this.POST, endpoint, body)
  }

  async put (endpoint, body) {
    return this.request(this.PUT, endpoint, body)
  }

  async request (method, endpoint, body, isJSON=true) {
    if (isJSON) {
      body = body ? JSON.stringify(body) : undefined
    }
    const resp = await fetch(
      API_URL + endpoint,
      {
        body,
        headers: this.headers(isJSON),
        method
      }
    )

    const json = await resp.json()
    switch (resp.status) {
      case 400:
        throw new Error(json.error)
      case 401:
        throw new Error(json.error)
    }
    return json

  }

  uploadImage (endpoint, photoID, imageLocation) {
    const data = new FormData()
    const name = `${photoID}.jpg`
    data.append('file', {
      name,
      uri: imageLocation,
      type: 'image/jpeg',
    })
    return this.request(this.POST, endpoint, data, false)
  }
}