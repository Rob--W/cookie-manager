SOURCES = $(wildcard cookie-manager.* cookie-manager-firefox.js icons/*.png) manifest.json background.js

CHROME_ZIP = cookie-manager-chrome.zip
FIREFOX_ZIP = cookie-manager-firefox.zip

.PHONY: all clean

all: clean $(CHROME_ZIP) $(FIREFOX_ZIP)

# TODO: Firefox/Chrome-specific (optimized) manifest files?

$(CHROME_ZIP): $(SOURCES)
	7z u $@ $(SOURCES)

$(FIREFOX_ZIP): $(SOURCES)
	7z u $@ $(SOURCES)

clean:
	rm -f $(CHROME_ZIP) $(FIREFOX_ZIP)
