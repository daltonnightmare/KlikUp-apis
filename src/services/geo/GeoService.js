const Constants = require('../../configuration/constants');
const { AdresseModel } = require('../../models');

class GeoService {
  constructor() {
    this.nominatimUrl = 'https://nominatim.openstreetmap.org';
    this.routingUrl = 'https://router.project-osrm.org';
  }

  /**
   * Géocoder une adresse (obtenir des coordonnées)
   */
  async geocode(address) {
    try {
      const params = new URLSearchParams({
        q: address,
        format: 'json',
        limit: 1,
        'accept-language': 'fr'
      });

      const response = await fetch(`${this.nominatimUrl}/search?${params}`, {
        headers: {
          'User-Agent': 'YourApp/1.0'
        }
      });

      const data = await response.json();

      if (data.length === 0) {
        return null;
      }

      const result = data[0];
      return {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        displayName: result.display_name,
        boundingbox: result.boundingbox
      };
    } catch (error) {
      console.error('Erreur géocodage:', error);
      throw new Error(`Échec géocodage: ${error.message}`);
    }
  }

  /**
   * Géocodage inverse (obtenir une adresse à partir de coordonnées)
   */
  async reverseGeocode(lat, lng) {
    try {
      const params = new URLSearchParams({
        lat,
        lon: lng,
        format: 'json',
        'accept-language': 'fr'
      });

      const response = await fetch(`${this.nominatimUrl}/reverse?${params}`, {
        headers: {
          'User-Agent': 'YourApp/1.0'
        }
      });

      const data = await response.json();

      if (!data || !data.display_name) {
        return null;
      }

      return {
        displayName: data.display_name,
        address: data.address,
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lon)
      };
    } catch (error) {
      console.error('Erreur géocodage inverse:', error);
      throw new Error(`Échec géocodage inverse: ${error.message}`);
    }
  }

  /**
   * Calculer un itinéraire
   */
  async calculateRoute(startLat, startLng, endLat, endLng, profile = 'driving') {
    try {
      const url = `${this.routingUrl}/route/v1/${profile}/${startLng},${startLat};${endLng},${endLat}`;
      
      const response = await fetch(url, {
        params: {
          overview: 'full',
          geometries: 'geojson',
          steps: true
        }
      });

      const data = await response.json();

      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error('Aucun itinéraire trouvé');
      }

      const route = data.routes[0];
      
      return {
        distance: route.distance, // en mètres
        duration: route.duration, // en secondes
        geometry: route.geometry,
        legs: route.legs.map(leg => ({
          distance: leg.distance,
          duration: leg.duration,
          steps: leg.steps.map(step => ({
            distance: step.distance,
            duration: step.duration,
            instruction: step.maneuver?.instruction || step.name,
            geometry: step.geometry
          }))
        }))
      };
    } catch (error) {
      console.error('Erreur calcul itinéraire:', error);
      throw new Error(`Échec calcul itinéraire: ${error.message}`);
    }
  }

  /**
   * Calculer la distance entre deux points
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // Rayon de la Terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance en mètres
  }

  /**
   * Vérifier si un point est dans une zone
   */
  pointInPolygon(lat, lng, polygon) {
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  /**
   * Trouver des points dans un rayon
   */
  async findNearbyPoints(lat, lng, radius, points) {
    return points.filter(point => {
      const distance = this.calculateDistance(
        lat, lng,
        point.lat, point.lng
      );
      return distance <= radius;
    }).map(point => ({
      ...point,
      distance: this.calculateDistance(lat, lng, point.lat, point.lng)
    })).sort((a, b) => a.distance - b.distance);
  }

  /**
   * Estimer le prix de livraison
   */
  estimateDeliveryPrice(distance, basePrice, pricePerKm, minPrice = null) {
    const price = basePrice + (distance / 1000) * pricePerKm;
    return minPrice ? Math.max(price, minPrice) : price;
  }

  /**
   * Calculer le temps de livraison estimé
   */
  estimateDeliveryTime(distance, averageSpeed = 30) {
    // averageSpeed en km/h
    const hours = distance / 1000 / averageSpeed;
    const minutes = Math.ceil(hours * 60);
    
    // Ajouter le temps de préparation
    return {
      minutes,
      formatted: this.formatDuration(minutes)
    };
  }

  /**
   * Formater une durée
   */
  formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    
    if (remainingMinutes === 0) {
      return `${hours}h`;
    }
    
    return `${hours}h ${remainingMinutes}min`;
  }

  /**
   * Valider des coordonnées GPS
   */
  validateCoordinates(lat, lng) {
    return (
      typeof lat === 'number' && !isNaN(lat) &&
      typeof lng === 'number' && !isNaN(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180
    );
  }

  /**
   * Obtenir la ville à partir de coordonnées
   */
  async getCityFromCoordinates(lat, lng) {
    const result = await this.reverseGeocode(lat, lng);
    
    if (result && result.address) {
      return result.address.city || result.address.town || result.address.village || result.address.county;
    }
    
    return null;
  }

  /**
   * Obtenir le fuseau horaire à partir de coordonnées
   */
  async getTimezone(lat, lng) {
    try {
      const response = await fetch(
        `https://api.timezonedb.com/v2.1/get-time-zone?key=${process.env.TIMEZONE_API_KEY}&format=json&by=position&lat=${lat}&lng=${lng}`
      );
      
      const data = await response.json();
      
      if (data.status === 'OK') {
        return data.zoneName;
      }
      
      return 'Africa/Ouagadougou'; // Par défaut
    } catch (error) {
      console.error('Erreur récupération fuseau horaire:', error);
      return 'Africa/Ouagadougou';
    }
  }
}

module.exports = new GeoService();