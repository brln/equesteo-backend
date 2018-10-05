export function currentTime() {
  const nowTime = new Date
  return ((nowTime.getHours() < 10)?"0":"") + nowTime.getHours() +":"+
    ((nowTime.getMinutes() < 10)?"0":"") + nowTime.getMinutes() +":"+
    ((nowTime.getSeconds() < 10)?"0":"") + nowTime.getSeconds()
}

const toRad = (deg) => {
  return deg * Math.PI / 180;
}

export function haversine (lat1, lon1, lat2, lon2) {
  const R = 3959; // mi
  const x1 = lat2 - lat1
  const dLat = toRad(x1)
  const x2 = lon2 - lon1
  const dLon = toRad(x2)
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


function urlParams (params) {
  return Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&')
}

export function staticMap (ride) {
  const ROOT_URL = 'https://maps.googleapis.com/maps/api/staticmap?'
  const queryStringParams = {
    size: '800x450',
    format: 'png',
    maptype: 'terrain',
  }
  const pathStyle = 'color:0xff0000ff|weight:5'

  const MAX_NUM_COORDS = 250 // Google static maps API limit of 8096 chars in URL
  const numCoords = ride.rideCoordinates.length
  let nth = numCoords / MAX_NUM_COORDS
  nth = (nth < 1) ? 1 : Math.ceil(nth)
  let pathCoords = ''
  for (let i = 0; i < numCoords; i++) {
    const coordinate = ride.rideCoordinates[i]
    if (i % nth === 0) {
      pathCoords += `|${coordinate.latitude},${coordinate.longitude}`
    }
  }

  queryStringParams['path'] = pathStyle + pathCoords
  const queryString = urlParams(queryStringParams)
  return ROOT_URL + queryString
}

export function pwResetCode () {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const codeLength = 16
  for (let i = 1; i <= codeLength; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
    if (i % 4 === 0 && i !== codeLength) {
      text += ' '
    }
  }
  return text;
}

export function newRideName (currentRide) {
  let name
  const hour = (new Date(currentRide.startTime)).getHours()
  if (hour < 5) {
    name = 'Early Morning Ride'
  } else if (hour < 10) {
    name = 'Morning Ride'
  } else if (hour < 14) {
    name = 'Lunch Ride'
  } else if (hour < 17) {
    name = 'Afternoon Ride'
  } else if (hour < 20) {
    name = 'Evening Ride'
  } else if (hour < 25 ) {
    name = 'Night Ride'
  }
  return name
}

export const unixTimeNow = () => {
  return Math.floor(new Date().getTime())
}
