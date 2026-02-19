# ViewStat-First-24-Hour-View-Scraper

# ViewStats Hourly Views Scraper

This script uses Puppeteer with a persistent Chrome profile to extract hourly view data from ViewStats and creates a csv, cleaned data as output along with a json raw data file.This is a UI based extraction as the API of this platform is not public. The code parses through 150 points on the chart/graph and captures the 25 data points that have been used to make the chart/graph.




https://github.com/user-attachments/assets/15f57c18-a459-4641-9ac7-bba1d490cd79



## Notes
- Requires manual login on first run
- Uses chart hover detection (canvas/SVG)
- Data accuracy depends on UI rounding behavior

## Usage
1. Install dependencies
2. Run script
3. Login on first run if prompted

