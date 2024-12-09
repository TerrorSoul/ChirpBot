// config/constants.js
export const DEFAULT_SETTINGS = {
    warning_threshold: 3,
    warning_expire_days: 30,
    cooldowns: {
        quote: 5,
        wiki: 3,
        createmod: 10,
        warn: 5,
        kick: 5,
        ban: 5,
        clear: 5,
    }
};

export const VEHICLES = [
    "Helicopter", "Tank", "Submarine", "Space Shuttle", "Monster Truck",
    "Racing Car", "Amphibious Vehicle", "Hovercraft", "Flying Car",
    "Walking Mech", "Boat", "VTOL Aircraft", "Rover", "Dragster",
    "Stunt Plane", "Battle Robot", "Mining Vehicle", "Rescue Vehicle"
];

export const CHALLENGES = [
    "Build a vehicle that can drive upside down",
    "Create a transforming vehicle",
    "Build the smallest possible flying vehicle",
    "Make a vehicle that works both underwater and in the air",
    "Create a vehicle powered only by thrusters",
    "Build a walking vehicle with no wheels",
    "Make a vehicle that can climb vertical walls",
    "Create a self-balancing vehicle",
    "Build a vehicle that can flip itself over",
    "Create a vehicle that can grab and move objects"
];

export const WELCOME_MESSAGES = [
    "Welcome to our Trailmakers community! Chirpos are watching, so make it good!",
    "A new builder has joined! Melvin approves (probably).",
    "{user}, our newest recruit! Don't let the Chirpos steal your blueprints!",
    "Another creative genius joins us! {user}, show us what you've got!",
    "Welcome to the workshop! Melvin says hi to {user}... or maybe it was a threat?",
    "A new engineer in the making! Chirpos are already scheming against your creations!",
    "{user} has arrived! Time to build something Melvin would fear (or laugh at).",
    "Welcome to the chaos lab! Remember {user}, if it explodes, it's probably fine.",
    "A new Trailblazer, {user}, has entered the server!",
    "Welcome! The Chirpos are already plotting to make {user}'s builds 'disappear.'",
    "Ahoy {user}! Melvin's keeping an eye on you... no pressure.",
    "Welcome to our Trailmakers community! Just don't ask Melvin for advice.",
    "The garage doors open for {user}, our newest creator!",
    "Another Trailmaker joins! Don't worry {user}, we've all been squished by Melvin at least once.",
    "Welcome, {user}, fearless inventor! Just remember, the best builds involve a little chaos.",
    "A new builder arrives! {user}'s first challenge: survive Melvin's stare.",
    "Welcome to the crew! Time to build, crash, and repeat!",
    "Welcome {user}! Let's turn your wildest ideas into reality!"
];