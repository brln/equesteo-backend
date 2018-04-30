export function currentTime() {
  const nowTime = new Date
  return ((nowTime.getHours() < 10)?"0":"") + nowTime.getHours() +":"+
    ((nowTime.getMinutes() < 10)?"0":"") + nowTime.getMinutes() +":"+
    ((nowTime.getSeconds() < 10)?"0":"") + nowTime.getSeconds()
}