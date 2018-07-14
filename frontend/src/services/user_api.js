import ApiClient from './api_client'

export default class UserAPI {

  constructor (token) {
    this.apiClient = new ApiClient(token)
  }

  async login (email, password) {
    return await this.apiClient.post('/users/login', {
      email: email,
      password: password,
    })
  }
}