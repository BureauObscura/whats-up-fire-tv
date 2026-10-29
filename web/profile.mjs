// Build profile (scripts/build-web.mjs, WHATSUP_PROFILE): which services this build talks
// to. Everything the user is told (first-run consent, Privacy, search screen, credits) is
// written from the same entry, so it always matches what the build really contacts.
//  - personal (default): the owner's own TV. adsb.fi positions (personal, non-commercial use
//    only), Planespotters photos, EOX imagery outside the US, Nominatim for addresses
//    outside the US.
//  - store: the public app. adsb.lol positions (ODbL, commercial use allowed); no exact
//    aircraft photos (bundled model photo, then silhouette); no EOX (Atlas Satellite outside
//    the US shows the vector map); no Nominatim (Census for U.S. addresses, Open-Meteo for
//    cities and postcodes).
const PROFILES={
  personal:{
    id:'personal',
    feed:'adsb.fi',
    feedUrl:(lat,lon,nm)=>`https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nm}`,
    photos:true,eox:true,nominatim:true,
    creditFlash:'Aircraft adsb.fi',
    consent:'To show planes near you, this app sends your approximate location, rounded to a few miles, to public flight and map services (adsb.fi, OpenFreeMap, Open-Meteo, USGS, EOX). It looks up the planes it shows with ADSB.lol and Planespotters. Your first city guess comes from your internet address (GeoJS). What you type in search goes to Open-Meteo, the U.S. Census Bureau or OpenStreetMap to find the place. Every service also sees your TV’s internet address. Your settings and history are saved only on this TV. No accounts, ads or analytics. You can erase it all in Settings.',
    searchAlts:['Search uses Open-Meteo, the U.S. Census Bureau and OpenStreetMap.','Search: Open-Meteo, U.S. Census Bureau, OpenStreetMap'],
  },
  store:{
    id:'store',
    feed:'adsb.lol',
    feedUrl:(lat,lon,nm)=>`https://api.adsb.lol/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nm}`,
    photos:false,eox:false,nominatim:false,
    // adsb.lol's anonymous limit: four requests 5 s apart then 429; one every 10 s holds.
    minPollSeconds:10,
    creditFlash:'Positions: adsb.lol (ODbL)',
    consent:'To show planes near you, this app sends your approximate location, rounded to a few miles, to public flight and map services (adsb.lol, OpenFreeMap, Open-Meteo, USGS). It looks up the routes of the planes it shows with ADSB.lol. Your first city guess comes from your internet address (GeoJS). What you type in search goes to Open-Meteo or the U.S. Census Bureau to find the place. Every service also sees your TV’s internet address. Your settings and history are saved only on this TV. No accounts, ads or analytics. You can erase it all in Settings.',
    searchAlts:['Search uses Open-Meteo and the U.S. Census Bureau.','Search: Open-Meteo, U.S. Census Bureau'],
  },
};
export const profileFor=id=>PROFILES[id]||PROFILES.personal;
export const PROFILE=profileFor(globalThis.__whatsupProfile);
