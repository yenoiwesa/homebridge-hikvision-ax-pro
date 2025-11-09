# Homebridge Hikvision AX Pro

Homebridge plugin for integrating Hikvision AX Pro alarm systems with Apple HomeKit.

## Features

- **Security System Control**: Arm/disarm your Hikvision AX Pro alarm system from HomeKit
  - Away mode
  - Stay (Home) mode
  - Disarm
- **Motion Detection**: Each zone appears as a motion sensor in HomeKit
- **Real-time Updates**: Automatic polling for status changes
- **Multiple Subsystems**: Support for multiple alarm subsystems

## Installation

1. Install Homebridge (if not already installed):

```bash
npm install -g homebridge
```

2. Install this plugin:

```bash
npm install -g homebridge-hikvision-ax-pro
```

Or install via Homebridge Config UI X by searching for "Hikvision AX Pro"

## Configuration

Add the platform to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "HikvisionAxPro",
      "name": "Hikvision AX Pro",
      "host": "192.168.1.120",
      "username": "your_username",
      "password": "your_password",
      "userLevel": 1,
      "pollingInterval": 5000
    }
  ]
}
```

### Configuration Parameters

| Parameter         | Required | Default | Description                                    |
| ----------------- | -------- | ------- | ---------------------------------------------- |
| `platform`        | Yes      | -       | Must be `HikvisionAxPro`                       |
| `name`            | Yes      | -       | Name of the platform                           |
| `host`            | Yes      | -       | IP address of your AX Pro panel                |
| `username`        | Yes      | -       | Username for panel access                      |
| `password`        | Yes      | -       | Password for panel access                      |
| `userLevel`       | No       | `1`     | User level (0 = installer, 1 = admin/operator) |
| `pollingInterval` | No       | `5000`  | Status polling interval in milliseconds        |

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/homebridge-hikvision-ax-pro.git
cd homebridge-hikvision-ax-pro

# Install dependencies
npm install

# Build the plugin
npm run build
```

### Testing

```bash
# Run integration tests
npm run test:integration

# Or run with ts-node directly
npm run test:dev
```

### Link for Development

```bash
# Build and link
npm run build
npm link

# Watch for changes
npm run watch
```

## Supported Devices

- Hikvision AX Pro alarm panels
- All compatible zones/sensors

## Troubleshooting

### Plugin not appearing in HomeKit

1. Verify your Homebridge configuration is valid JSON
2. Check Homebridge logs for errors
3. Ensure the panel IP address is correct and accessible

### Authentication failures

1. Verify username and password
2. Try different `userLevel` values (0 or 1)
3. Check that the account is not locked on the panel

### Status not updating

1. Increase the `pollingInterval` if network is slow
2. Check network connectivity to the panel
3. Review Homebridge logs for communication errors

## License

ISC

## Credits

Built with the [Homebridge Plugin Template](https://github.com/homebridge/homebridge-plugin-template)
