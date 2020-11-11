const Homey = require('homey');
const cloudLib = require('crownstone-cloud');
const sseLib = require('crownstone-sse');

const cloud = new cloudLib.CrownstoneCloud();
const sse = new sseLib.CrownstoneSSE();
let sphereId;
let inLocationName;
let inLocationId;

const presenceTrigger = new Homey.FlowCardTrigger('user_enters_room');
const presenceCondition = new Homey.FlowCardCondition('user_presence');

/**
 * This code runs when a trigger has been fired. If the room name and id are equal, the flow will run.
 */
presenceTrigger.register().registerRunListener((args, state) => Promise.resolve(args.rooms.name === state.name && args.rooms.id === state.id));

/**
 * This code runs after a trigger has been fired and a condition-card is configured in the flow.
 * If the room name and id are equal to the name and id from the room the user is currently in, the flow will run.
 */
presenceCondition.register().registerRunListener(async (args) => {
  await getCurrentLocation(() => {}).catch((e) => { console.log('There was a problem getting the user location:', e); });
  if (typeof inLocationId !== 'undefined' && typeof inLocationName !== 'undefined') {
    return Promise.resolve(args.rooms.id === inLocationId && args.rooms.name === inLocationName);
  }
  return false;
});

/**
 * This code runs when a flow is being constructed for a trigger-card, and a room should be selected.
 * This code returns a list of rooms in a sphere which is shown to the user.
 */
presenceTrigger.getArgument('rooms').registerAutocompleteListener(() => Promise.resolve(getRooms().catch((e) => { console.log('There was a problem obtaining the rooms:', e); })));

/**
 * This code runs when a flow is being constructed for a condition-card, and a room should be selected.
 * This code returns a list of rooms in a sphere.
 */
presenceCondition.getArgument('rooms').registerAutocompleteListener(() => Promise.resolve(getRooms().catch((e) => { console.log('There was a problem obtaining the rooms:', e); })));

/**
 * This class gets the data from the form shown to the user when the latter install the Crownstone app. There are
 * only two fields, email and password. This is used to retrieve all information from the Crownstone cloud.
 */
class CrownstoneApp extends Homey.App {
  /**
   * This method is called when the App is initialized.
   * The email and password for the Crownstone Cloud from the user will be obtained using the data from the form.
   * Instances of the flowcard triggers and conditions are inited.
   */
  onInit() {
    this.log(`App ${Homey.app.manifest.name.en} is running...`);
    this.email = Homey.ManagerSettings.get('email');
    this.password = Homey.ManagerSettings.get('password');
    loginToCloud(this.email, this.password).catch((e) => { console.log('There was a problem making a connection with the cloud:', e); });
    loginToEventServer(this.email, this.password).catch((e) => { console.log('There was a problem making a connection with the event server:', e); });

    /**
     * This function will fire when a user changed the credentials in the settings-page.
     */
    Homey.ManagerSettings.on('set', function () {
      this.email = Homey.ManagerSettings.get('email');
      this.password = Homey.ManagerSettings.get('password');
      loginToCloud(this.email, this.password).catch((e) => { console.log('There was a problem making a connection with the cloud:', e); });
      loginToEventServer(this.email, this.password).catch((e) => { console.log('There was a problem making a connection with the event server:', e); });
    });
  }

  /**
   * This method will call the getCurrentLocation function and returns the sphere ID with a callback.
   */
  getLocation(callback) {
    getCurrentLocation(() => {
      callback(cloud, sphereId);
    }).catch((e) => { console.log('There was a problem getting the user location:', e); });
  }

  /**
   * This method will return the instance of the cloud.
   */
  getCloud() {
    return cloud;
  }
}

/**
 * This function will make a connection with the cloud and obtain the userdata.
 */
async function loginToCloud(email, password) {
  await cloud.login(email, password);
}

/**
 * This function will stop all running eventHandlers, in case a user enters other credentials,
 * make a new connection with the sse-server and starts the eventHandler.
 */
async function loginToEventServer(email, password) {
  await sse.stop();
  await sse.login(email, password);
  await sse.start(eventHandler);
}

/**
 * The eventHandler receives events from the sse-server and fires the presenceTrigger when a user enters a room.
 */
let eventHandler = (data) => {
  if (data.type === 'presence' && data.subType === 'enterLocation') {
    const state = { name: data.location.name, id: data.location.id };
    presenceTrigger.trigger(null, state).then(this.log).catch(this.error);
  }
};

/**
 * This function will obtain the sphere and, if available, the room where the user is currently located.
 */
async function getCurrentLocation(callback) {
  const userReference = await cloud.me();
  const userLocation = await userReference.currentLocation();
  if (userLocation.length > 0) {
    const spheres = await cloud.spheres();
    if (spheres.length > 0) {
      sphereId = userLocation[0].inSpheres[0].sphereId;
      inLocationName = await userLocation[0].inSpheres[0].inLocation.locationName;
      inLocationId = await userLocation[0].inSpheres[0].inLocation.locationId;
      callback();
    } else {
      console.log('Unable to find sphere');
    }
  } else {
    console.log('Unable to locate user');
  }
}

/**
 * This function obtains all the rooms of the sphere where the user is currently located in.
 */
async function getRooms() {
  await getCurrentLocation(() => {}).catch((e) => { console.log('There was a problem getting the user location:', e); });
  const rooms = await cloud.sphere(sphereId).locations();
  if (rooms.length > 0) {
    return listRooms(rooms);
  }
  console.log('Unable to find any rooms');
  return null;
}

/**
 * This function returns a json list with all the rooms in the sphere.
 * [todo:] add custom icons
 */
function listRooms(rooms) {
  const roomList = [];
  for (let i = 0; i < rooms.length; i++) {
    const room = {
      name: rooms[i].name,
      id: rooms[i].id,
    };
    roomList.push(room);
  }
  return roomList;
}

module.exports = CrownstoneApp;
