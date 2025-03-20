import 'dotenv/config'
import Fastify from 'fastify'
import { submitForReview } from './submission.js'
import fetch from 'node-fetch'

// In-memory storage for recipes
const recipeStorage = {
  recipes: [],
  lastId: 0,
  add(cityId, content) {
    const id = ++this.lastId
    const recipe = { id, content, cityId }
    this.recipes.push(recipe)
    return recipe
  },
  getById(id) {
    return this.recipes.find(recipe => recipe.id === parseInt(id))
  },
  getByCityId(cityId) {
    return this.recipes.filter(recipe => recipe.cityId === cityId)
  },
  deleteById(id) {
    const index = this.recipes.findIndex(recipe => recipe.id === parseInt(id))
    if (index !== -1) {
      this.recipes.splice(index, 1)
      return true
    }
    return false
  }
}

const API_KEY = process.env.API_KEY

// Base URLs for external APIs
const CITY_API_BASE_URL = 'https://api-ugi2pflmha-ew.a.run.app/cities'
const WEATHER_API_BASE_URL = 'https://api-ugi2pflmha-ew.a.run.app/weather-predictions'

const fastify = Fastify({
  logger: true,
})

// Register JSON body parser
fastify.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
  try {
    const json = JSON.parse(body)
    done(null, json)
  } catch (err) {
    err.statusCode = 400
    done(err, undefined)
  }
})

// GET /cities/:cityId/infos
fastify.get('/cities/:cityId/infos', async (request, reply) => {
  const { cityId } = request.params
  
  try {
    // Get city info from City API
    console.log('Fetching city data...');
    const cityResponse = await fetch(`${CITY_API_BASE_URL}/${cityId}/insights?apiKey=${API_KEY}`)
    
    if (!cityResponse.ok) {
      if (cityResponse.status === 404) {
        return reply.code(404).send({ error: 'City not found' })
      }
      throw new Error(`City API error: ${cityResponse.statusText}`)
    }
    
    const cityData = await cityResponse.json()
    console.log('City data:', cityData);
    
    // Validate city data format
    if (!cityData.coordinates || typeof cityData.coordinates.latitude !== 'number' || 
        typeof cityData.coordinates.longitude !== 'number') {
      throw new Error('Invalid coordinates format from City API')
    }
    
    if (typeof cityData.population !== 'number' || !Number.isInteger(cityData.population)) {
      throw new Error('Invalid population format from City API')
    }
    
    if (!Array.isArray(cityData.knownFor)) {
      throw new Error('Invalid knownFor format from City API')
    }
    
    // Get weather predictions from Weather API
    console.log('Fetching weather data...');
    const weatherResponse = await fetch(`${WEATHER_API_BASE_URL}?lat=${cityData.coordinates.latitude}&lon=${cityData.coordinates.longitude}&apiKey=${API_KEY}`)
    
    if (!weatherResponse.ok) {
      throw new Error(`Weather API error: ${weatherResponse.statusText}`)
    }
    
    const weatherDataArray = await weatherResponse.json()
    console.log('Weather data array:', weatherDataArray);
    
    // Find weather for this city
    const weatherData = weatherDataArray.find(cityWeather => cityWeather.cityId === cityId)
    
    if (!weatherData || !weatherData.predictions || weatherData.predictions.length < 2) {
      throw new Error('Weather data not found for this city')
    }
    
    // Find today and tomorrow predictions
    const todayPrediction = weatherData.predictions.find(p => p.when === 'today')
    const tomorrowPrediction = weatherData.predictions.find(p => p.when === 'tomorrow')
    
    if (!todayPrediction || !tomorrowPrediction) {
      throw new Error('Missing predictions for today or tomorrow')
    }
    
    // Get recipes for this city and ensure proper format
    const recipes = recipeStorage.getByCityId(cityId).map(recipe => ({
      id: parseInt(recipe.id),
      content: String(recipe.content)
    }))
    
    // Format response according to requirements
    const response = {
      coordinates: [
        Number(cityData.coordinates.latitude),
        Number(cityData.coordinates.longitude)
      ],
      population: parseInt(cityData.population),
      knownFor: cityData.knownFor.map(String),
      weatherPredictions: [
        {
          when: 'today',
          min: Number(todayPrediction.min),
          max: Number(todayPrediction.max)
        },
        {
          when: 'tomorrow',
          min: Number(tomorrowPrediction.min),
          max: Number(tomorrowPrediction.max)
        }
      ],
      recipes
    }
    
    return response
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Internal server error' })
  }
})

// POST /cities/:cityId/recipes
fastify.post('/cities/:cityId/recipes', async (request, reply) => {
  const { cityId } = request.params
  const { content } = request.body || {}
  
  // Validate content
  if (!content) {
    return reply.code(400).send({ error: 'Content is required' })
  }
  
  if (content.length < 10) {
    return reply.code(400).send({ error: 'Content is too short (minimum 10 characters)' })
  }
  
  if (content.length > 2000) {
    return reply.code(400).send({ error: 'Content is too long (maximum 2000 characters)' })
  }
  
  try {
    // Check if city exists
    const cityResponse = await fetch(`${CITY_API_BASE_URL}/${cityId}/insights?apiKey=${API_KEY}`)
    
    if (!cityResponse.ok) {
      if (cityResponse.status === 404) {
        return reply.code(404).send({ error: 'City not found' })
      }
      throw new Error(`City API error: ${cityResponse.status}`)
    }
    
    // Add recipe
    const recipe = recipeStorage.add(cityId, content)
    
    return reply.code(201).send({ id: recipe.id, content: recipe.content })
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Internal server error' })
  }
})

// DELETE /cities/:cityId/recipes/:recipeId
fastify.delete('/cities/:cityId/recipes/:recipeId', async (request, reply) => {
  const { cityId, recipeId } = request.params
  
  try {
    // Check if city exists
    const cityResponse = await fetch(`${CITY_API_BASE_URL}/${cityId}/insights?apiKey=${API_KEY}`)
    
    if (!cityResponse.ok) {
      if (cityResponse.status === 404) {
        return reply.code(404).send({ error: 'City not found' })
      }
      throw new Error(`City API error: ${cityResponse.status}`)
    }
    
    // Get recipe
    const recipe = recipeStorage.getById(recipeId)
    
    if (!recipe) {
      return reply.code(404).send({ error: 'Recipe not found' })
    }
    
    if (recipe.cityId !== cityId) {
      return reply.code(404).send({ error: 'Recipe not found for this city' })
    }
    
    // Delete recipe
    recipeStorage.deleteById(recipeId)
    
    return reply.code(204).send()
  } catch (err) {
    request.log.error(err)
    return reply.code(500).send({ error: 'Internal server error' })
  }
})

// Start the server
fastify.listen(
  {
    port: process.env.PORT || 3000,
    host: process.env.RENDER_EXTERNAL_URL ? '0.0.0.0' : process.env.HOST || 'localhost',
  },
  function (err) {
    if (err) {
      fastify.log.error(err)
      process.exit(1)
    }

    fastify.log.info(`Server listening on ${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`)

    //////////////////////////////////////////////////////////////////////
    // Don't delete this line, it is used to submit your API for review //
    // everytime your start your server.                                //
    //////////////////////////////////////////////////////////////////////
    submitForReview(fastify)
  }
)
