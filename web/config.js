// Defaults. The home location, alert radius and units are chosen on the device
// (Settings) and saved there; nothing here is tied to one city.
export const CONFIG = Object.freeze({
  radiusMiles: 3,   // alert boundary, 1-10
  rangeMiles: 10,   // default map radius (Settings: 2-250 mi)
  searchNm: 15,     // surrounding traffic fetched from adsb.fi at the default radius
  pollSeconds: 5,   // adsb.fi asks for at most 1 request per second; 5 s keeps well under it
});
