export default class Pub {
  constructor(id, name, lat, lon, address, features, photoUrl, isVisited = false) {
    this.id = id;
    this.name = name;
    this.lat = lat;
    this.lon = lon;
    this.address = address;
    this.features = features; // Array of strings
    this.photoUrl = photoUrl;
    this.isVisited = isVisited;
  }
}