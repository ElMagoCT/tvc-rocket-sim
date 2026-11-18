# TVC Rocket: model and flight simulation

A website for a finless model rocket that steers with a gimballed motor.

- **Window 1, the rocket.** The real v7 CAD in 3D. The gimbal swings through the actual servo arms and pushrods. The recovery sequence plays: latch horn, spring, nose, then canopy. A faint current runs through the wiring.
- **Window 2, the flight simulation.** A rigid-body flight on an Estes D12, replayed in 3D from the pad to landing. The flight computer is modelled too: noisy sensors, 200 Hz control loop, 50 Hz servo frames. Telemetry charts sit underneath: altitude, vertical speed, accelerometer, gyro, tilt, gimbal servo commands, gimbal deflection and the chute servo. All the charts follow the replay, and clicking a chart jumps the replay to that time.

Live site: https://elmagoct.github.io/tvc-rocket-sim/

## Updating the numbers

Every number on the site comes from **`data/rocket.json`**:

- `specs`: the spec sheet. Each entry has a `status` tag: `official`, `cad`, `spec`, `sim` or `estimate`. When a measured value arrives, change the number and set `status` to `official`.
- `sim`: what the simulator uses: mass, centre of gravity, inertia, aero, sensor noise, control gains, detection thresholds and the parachute.
- `motor.curve`: the thrust curve (time in s, thrust in N).

## How the simulation works (`js/sim.js`)

- **Physics.** Six degrees of freedom with a quaternion attitude. Thrust acts at the gimbal pivot and points along the gimballed motor axis. The motor loses propellant mass as it burns, which moves the centre of gravity.
- **Aerodynamics.** Axial drag, plus cross-flow drag on ten body stations, which gives pitch damping and the drag of a tumbling body. Lift on the nose cone (CNα = 2/rad at the nose's centre of pressure) is what makes a finless rocket unstable.
- **Gimbal.** Servo horn angle maps to gimbal angle through the real linkage (7.78 mm horn hole, 14.7 mm stud radius). Each SG90 moves at 600°/s and takes a new pulse only every 20 ms. The firmware's 400°/s slew limit is applied too.
- **Flight computer.** It reads a noisy MPU6050 and BMP280. Attitude comes from gyro integration, and the accelerometer only corrects it on the pad. The control law has the firmware's PID structure: the D term acts on the gyro, the integrator is clamped, and the output is clamped and slew-limited. On top of that the gains are scheduled by measured thrust.
- **State machine:**
  - Ignition: axial acceleration over 2 g for 5 samples.
  - Burnout: under 0.5 g for 50 ms.
  - Apogee: filtered baro altitude 0.6 m below its peak. This fires the chute servo.
  - Landing: baro altitude steady for 1 s while the IMU reads about 1 g.
- **Wind.** A mean wind plus random gusts, from a fixed seed so every run can be repeated.

Run a flight without a browser:

```
node tools/sim-check.mjs [seed] [wind m/s]
```

## The 3D model

`assets/rocket.glb` is built from the per-part STLs that `tvc-mech/rocket7.py` exports:

```
python tools/export_glb.py [path to the Rocket-v7 STL folder]
```

The script decimates the heavy STEP imports, from 181k to 54k triangles. It also writes `assets/rocket-geometry.json`, which holds the pivot, the servo shaft axes, the CAD mass, the centre of gravity and the inertia.

## Running it locally

The site is static files with no build step. Three.js loads from a CDN. Serve the folder with any static server, then open `http://127.0.0.1:5391`:

```
python -m http.server 5391 --bind 127.0.0.1
```
