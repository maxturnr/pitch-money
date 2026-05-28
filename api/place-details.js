// Google Places Details API
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { place_id } = req.query

  if (!place_id) {
    return res.status(400).json({ error: 'place_id is required' })
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' })
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=formatted_address,geometry,address_components&key=${apiKey}`
    
    const response = await fetch(url)
    const data = await response.json()

    if (data.status === 'OK') {
      return res.json(data)
    } else {
      console.error('Google Places Details error:', data)
      return res.status(500).json({ 
        error: 'Place details failed',
        details: data.error_message 
      })
    }
  } catch (error) {
    console.error('Place details error:', error)
    return res.status(500).json({ error: error.message })
  }
}
