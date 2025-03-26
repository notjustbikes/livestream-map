# Livestream Map for IRL Livestreams (NJB Live)

This node.js code takes input from a [an open source Android app](https://github.com/mendhak/gpslogger) and generates a map that can be used as a browser source in OBS, for use in IRL livestreaming.

I use this code, running on a Linux server, for my bicycle livestreams on [NJB Live](https://youtube.com/@njblive) to display a live map of where I am, along with street/city information, weather, and speed.

This code is a heavily-modified version of this project:
https://github.com/NOALBS/gps-logger

I have marked it as a fork in Github, but the code is barely recognisable, and many features have been refactored or removed from the original. Still it follows the same basic flow as gps-logger, and it would not have been possible for me to make this without them making it first.

You can check out [the original project](https://github.com/NOALBS/gps-logger) for instructions on how to register for API keys and to get this project up and running.