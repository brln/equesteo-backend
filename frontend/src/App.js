import React, { Component } from 'react';
import './App.css';
import UserAPI from './services/user_api'

import Upload from 'rc-upload'

class App extends Component {
  constructor (props) {
    super(props)
    this.state = {
      loggedIn: false,
      email: null,
      password: null,
      token: null,
    }
    this.changePassword = this.changePassword.bind(this)
    this.changeEmail = this.changeEmail.bind(this)
    this.logIn = this.logIn.bind(this)
  }

  async logIn () {
    const userAPI = new UserAPI()
    const resp = await userAPI.login(
      this.state.email,
      this.state.password
    )
    this.setState({
      loggedIn: true,
      token: resp.token
    })
  }

  changePassword (e) {
    this.setState({
      password: e.target.value
    })
  }

  changeEmail (e) {
    this.setState({
      email: e.target.value
    })
  }

  render() {
    let show = (
      <div>
        <div>
          <label>email: </label>
          <input type="text" onChange={this.changeEmail}/>
        </div>

        <div>
          <label>password: </label>
          <input type="password" onChange={this.changePassword}/>
        </div>

        <div>
          <button onClick={this.logIn}>Submit</button>
        </div>
      </div>
    )
    if (this.state.loggedIn) {
      show = (
        <Upload
          action="/gpxUploader"
          headers={{Authorization: "Bearer: " + this.state.token}}
        >
          <a>Upload GPX file</a>
        </Upload>
      )
    }
    return show
  }
}

export default App;
