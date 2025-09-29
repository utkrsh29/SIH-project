import express from "express";
import axios from "axios";
import path from "path";
import bcrypt from "bcrypt";

const app = express();
const port = 3000;

// Set view engine
app.set("view engine", "ejs");
app.set("views", path.join(path.resolve(), "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(path.resolve(), "public")));

// --- In-memory "Database" for demonstration purposes ---
const users = []; // Will store objects like { username, email, passwordHash, phone, farmArea, pincode, cropHistory: [] }

// --- SIMULATED SESSION for demonstration ---
// In a real app, use express-session or similar middleware
let loggedInUser = null; // This will hold the username of the "logged-in" user

// Middleware to make loggedInUser available to all templates (optional, but convenient)
app.use((req, res, next) => {
    res.locals.loggedInUsername = loggedInUser;
    res.locals.user = loggedInUser ? users.find(u => u.username === loggedInUser) : null;
    next();
});

// --- User Authentication Routes ---

// GET route for displaying the registration form
app.get("/register", (req, res) => {
    res.render("register", { messages: { success: null, error: null } });
});

// POST route for handling registration form submission
app.post("/register", async (req, res) => {
    const { username, email, password, confirm_password } = req.body;

    console.log("Received registration data:", req.body);

    if (!username || !email || !password || !confirm_password) {
        return res.render("register", { messages: { error: "All fields are required." } });
    }
    if (password !== confirm_password) {
        return res.render("register", { messages: { error: "Passwords do not match." } });
    }
    if (password.length < 6) {
        return res.render("register", { messages: { error: "Password must be at least 6 characters long." } });
    }

    const existingUser = users.find(u => u.username === username || u.email === email);
    if (existingUser) {
        return res.render("register", { messages: { error: "Username or Email already exists." } });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        users.push({
            username,
            email,
            passwordHash,
            phone: null,
            farmArea: null,
            pincode: null,
            cropHistory: []
        });
        console.log("New user registered:", { username, email, passwordHash });
        console.log("Current users:", users);

        res.redirect("/login?registrationSuccess=true");

    } catch (error) {
        console.error("Registration error:", error.message);
        res.render("register", { messages: { error: "An error occurred during registration. Please try again." } });
    }
});

// GET route for login form
app.get("/login", (req, res) => {
    let successMessage = null;
    if (req.query.registrationSuccess === 'true') {
        successMessage = "Registration successful! Please log in.";
    }
    res.render("login.ejs", { messages: { error: null, success: successMessage } });
});

// POST route for handling login submission
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    console.log("Attempting login for:", username);

    if (!username || !password) {
        return res.render("login", { messages: { error: "Username and password are required.", success: null } });
    }

    try {
        const user = users.find(u => u.username === username);

        if (!user) {
            return res.render("login", { messages: { error: "Invalid username or password.", success: null } });
        }

        const passwordMatch = await bcrypt.compare(password, user.passwordHash);

        if (passwordMatch) {
            console.log("Login successful for user:", username);
            loggedInUser = username; // Set our simulated session
            res.redirect("/profile"); // Redirect to profile page after login
        } else {
            console.log("Login failed: Incorrect password for user:", username);
            return res.render("login", { messages: { error: "Invalid username or password.", success: null } });
        }

    } catch (error) {
        console.error("Login error:", error.message);
        res.render("login", { messages: { error: "An error occurred during login. Please try again.", success: null } });
    }
});

// POST route for logout
app.post("/logout", (req, res) => {
    loggedInUser = null; // Clear our simulated session
    console.log("User logged out.");
    res.redirect("/"); // Redirect to home page
});


// --- Profile Page Route ---
app.get("/profile", (req, res) => {
    if (!res.locals.user) {
        return res.render("profile", {
            user: null,
            messages: { error: "You need to be logged in to view your profile." }
        });
    }

    res.render("profile", {
        user: res.locals.user,
        messages: { error: null }
    });
});


// --- Home page and Weather on Home functionality ---
app.get("/", (req, res) => {
    // Render home.ejs with no initial weather data or error
    res.render("home", {
        user: res.locals.user,
        weatherData: null, // No weather data initially
        weatherError: null, // No weather error initially
        pincode: null // No pincode initially
    });
});

app.post("/submit-pincode-home", async (req, res) => {
    const { pincode } = req.body;
    let weatherData = null;
    let weatherError = null;

    if (!pincode) {
        weatherError = "Please enter a pincode.";
    } else {
        try {
            // 1. Get coordinates from Nominatim
            const geoResponse = await axios.get(
                `https://nominatim.openstreetmap.org/search?q=${pincode}&format=json`
            );

            if (geoResponse.data.length === 0) {
                weatherError = "No coordinates found for this pincode.";
            } else {
                const location = geoResponse.data[0];
                const lat = location.lat;
                const lon = location.lon;

                // 2. Get current/daily forecast from Open-Meteo
                const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto`;
                const weatherResponse = await axios.get(weatherURL);
                const currentWeatherData = weatherResponse.data.current_weather;
                const dailyForecast = weatherResponse.data.daily;

                // For simplicity, let's use current_weather for live and daily for forecast
                // We'll extract first day's temperature_2m_max, temperature_2m_min, precipitation_sum
                // and use current_weather for temperature and wind.
                // You might need to refine mapping weathercode to conditions

                if (currentWeatherData && dailyForecast && dailyForecast.time && dailyForecast.time.length > 0) {
                     // We'll use the current weather for 'live' snapshot and max/min from first daily entry
                    weatherData = {
                        locationName: location.display_name,
                        temperature: currentWeatherData.temperature,
                        windspeed: currentWeatherData.windspeed,
                        // humidity and condition (weathercode) often need more detailed mapping
                        // For a quick fix, we'll map weathercode to a simple condition
                        condition: getWeatherCondition(currentWeatherData.weathercode),
                        humidity: "N/A", // Open-Meteo current_weather doesn't directly provide humidity
                                         // You'd need an hourly API call or another service for this if exact current humidity is needed
                        // Daily forecast for max/min if you want to include it here:
                        temp_max_today: dailyForecast.temperature_2m_max[0],
                        temp_min_today: dailyForecast.temperature_2m_min[0],
                        precipitation_today: dailyForecast.precipitation_sum[0]
                    };
                } else {
                    weatherError = "Could not fetch detailed weather data.";
                }
            }
        } catch (error) {
            console.error("Error fetching weather for home page:", error.message);
            weatherError = "Error fetching weather data. Please try again.";
        }
    }

    // Render home.ejs with the fetched data or error
    res.render("home", {
        user: res.locals.user,
        weatherData: weatherData,
        weatherError: weatherError,
        pincode: pincode // Pass back the entered pincode
    });
});

// Helper function to map Open-Meteo weather codes to a simple condition string
function getWeatherCondition(code) {
    if (code === 0) return "Clear sky";
    if (code > 0 && code < 3) return "Partly cloudy";
    if (code >= 3 && code < 5) return "Overcast";
    if (code >= 50 && code < 60) return "Drizzle";
    if (code >= 60 && code < 70) return "Rain";
    if (code >= 70 && code < 80) return "Snow";
    if (code >= 80 && code < 90) return "Rain showers";
    if (code >= 90) return "Thunderstorm";
    return "Unknown";
}


// --- Other Existing Routes ---

// Weather Forecast page
app.get("/weather-forecast", (req, res) => {
    res.render("index", { result: null, error: null, forecast: null, user: res.locals.user });
});

// Handle pincode form submission on Weather Forecast (Full 7-day forecast)
app.post("/get-coordinates", async (req, res) => { // This route is for your original weather forecast page
    const { pincode } = req.body;

    if (!pincode) {
        return res.render("index", { result: null, error: "Please provide a pincode", forecast: null, user: res.locals.user });
    }
    try {
        const geoResponse = await axios.get(
            `https://nominatim.openstreetmap.org/search?q=${pincode}&format=json`
        );
        if (geoResponse.data.length === 0) {
            return res.render("index", { result: null, error: "No coordinates found for this pincode", forecast: null, user: res.locals.user });
        }
        const location = geoResponse.data[0];
        const lat = location.lat;
        const lon = location.lon;

        const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&timezone=auto`; // Added weathercode
        const weatherResponse = await axios.get(weatherURL);
        const forecastData = weatherResponse.data.daily;

        res.render("index", {
            result: {
                pincode,
                latitude: lat,
                longitude: lon,
                display_name: location.display_name,
            },
            forecast: forecastData,
            error: null,
            user: res.locals.user,
            getWeatherCondition: getWeatherCondition // Pass the helper function to EJS
        });
    } catch (error) {
        console.error("Error:", error.message);
        res.render("index", { result: null, error: "Error fetching data", forecast: null, user: res.locals.user });
    }
});

app.get("/crop-recommender", (req, res) => {
    res.render("crop-recommender", { user: res.locals.user }); // Assuming a crop-recommender.ejs exists
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});