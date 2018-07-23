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
  console.log('static map')
  const STATIC_MAPS_API_KEY = 'AIzaSyBhUmpq-7uQ2JaqtrHO3hpfeFHynVpo8xQ'
  const ROOT_URL = 'https://maps.googleapis.com/maps/api/staticmap?'
  const queryStringParams = {
    size: '580x350',
    format: 'png',
    maptype: 'terrain',
  }
  const pathStyle = 'color:0xff0000ff|weight:5'

  const MAX_NUM_COORDS = 250 // Google static maps API limit of 8096 chars in URL
  let nth = ride.rideCoordinates.length / MAX_NUM_COORDS
  nth = (nth < 1) ? 1 : Math.ceil(nth)
  let pathCoords = ''
  for (let i = 0; i < ride.rideCoordinates.length; i++) {
    const coordinate = ride.rideCoordinates[i]
    if (i % nth === 0) {
      pathCoords += `|${coordinate.latitude},${coordinate.longitude}`
    }
  }

  queryStringParams['path'] = pathStyle + pathCoords
  queryStringParams['key'] = STATIC_MAPS_API_KEY
  const queryString = urlParams(queryStringParams)
  return ROOT_URL + queryString
}

export function pwResetCode () {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const codeLength = 8
  for (let i = 1; i <= codeLength; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
    if (i % 4 === 0 && i !== codeLength) {
      text += ' '
    }
  }
  return text;
}

export const unixTimeNow = () => {
  return Math.floor(new Date().getTime())
}
