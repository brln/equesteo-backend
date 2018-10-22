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
    size: '600x400',
    format: 'png',
    maptype: 'terrain',
  }
  const pathStyle = 'color:0xff0000ff|weight:5'
  const toSimplify = ride.rideCoordinates.map((coord) => {
    return {
      lat: coord.latitude,
      lng: coord.longitude
    }
  })

  let tolerance = 0.00025
  let lengthURL = false
  let fullURL
  while (!lengthURL || lengthURL > 6000) {
    const simplified = simplifyLine(tolerance, toSimplify)
    console.log(tolerance)
    console.log('down to:----------------------------------------')
    console.log(simplified.length)

    let pathCoords = ''
    for (let coord of simplified) {
      const parsedLat = coord.lat.toString()
      const parsedLong = coord.lng.toString()
      pathCoords += `|${parsedLat},${parsedLong}`
    }

    queryStringParams['path'] = pathStyle + pathCoords
    const queryString = urlParams(queryStringParams)
    fullURL = ROOT_URL + queryString
    lengthURL = fullURL.length
    tolerance += 0.000001
  }
  return fullURL
}

function simplifyLine (tolerance, points) {
  var res = null;

  if(points.length){
    class Line {
      constructor(p1, p2 ) {
        this.p1 = p1;
        this.p2 = p2;
      }

      distanceToPoint ( point ) {
        // slope
        var m = ( this.p2.lat - this.p1.lat ) / ( this.p2.lng - this.p1.lng ),
          // y offset
          b = this.p1.lat - ( m * this.p1.lng ),
          d = [];
        // distance to the linear equation
        d.push( Math.abs( point.lat - ( m * point.lng ) - b ) / Math.sqrt( Math.pow( m, 2 ) + 1 ) );
        // distance to p1
        d.push( Math.sqrt( Math.pow( ( point.lng - this.p1.lng ), 2 ) + Math.pow( ( point.lat - this.p1.lat ), 2 ) ) );
        // distance to p2
        d.push( Math.sqrt( Math.pow( ( point.lng - this.p2.lng ), 2 ) + Math.pow( ( point.lat - this.p2.lat ), 2 ) ) );
        // return the smallest distance
        return d.sort( function( a, b ) {
          return ( a - b ); //causes an array to be sorted numerically and ascending
        } )[0];
      };
    };

    var douglasPeucker = function( points, tolerance ) {
      if ( points.length <= 2 ) {
        return [points[0]];
      }
      var returnPoints = [],
        // make line from start to end
        line = new Line( points[0], points[points.length - 1] ),
        // find the largest distance from intermediate poitns to this line
        maxDistance = 0,
        maxDistanceIndex = 0,
        p;
      for( var i = 1; i <= points.length - 2; i++ ) {
        var distance = line.distanceToPoint( points[ i ] );
        if( distance > maxDistance ) {
          maxDistance = distance;
          maxDistanceIndex = i;
        }
      }
      // check if the max distance is greater than our tollerance allows
      if ( maxDistance >= tolerance ) {
        p = points[maxDistanceIndex];
        line.distanceToPoint( p, true );
        // include this point in the output
        returnPoints = returnPoints.concat( douglasPeucker( points.slice( 0, maxDistanceIndex + 1 ), tolerance ) );
        // returnPoints.push( points[maxDistanceIndex] );
        returnPoints = returnPoints.concat( douglasPeucker( points.slice( maxDistanceIndex, points.length ), tolerance ) );
      } else {
        // ditching this point
        p = points[maxDistanceIndex];
        line.distanceToPoint( p, true );
        returnPoints = [points[0]];
      }
      return returnPoints;
    };
    res = douglasPeucker( points, tolerance );
    // always have to push the very last point on so it doesn't get left off
    res.push( points[points.length - 1 ] );
  }
  return res;
};


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
