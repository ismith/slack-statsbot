var SlackClient = require('slack-client');
var MessageLog = require('./message-log');

var RepositoryAttributeExtractor = require('./persistence/repository-attribute-extractor');

var VerboseGenderReportGenerator = require('./reports/verbose-gender');
var TerseReportGenerator = require('./reports/terse');

var DirectMessageHandler = require('./direct-message-handler');

var requestUnknownSelfIdentification = require('./request-unknown-self-identification');

var values = require('amp-values');
var moment = require('moment');

class StatsBot {
  constructor(adapter, userRepository, options) {
    this.adapter = adapter;
    this.adapter.registerListener(this);

    this.log = new MessageLog();
    this.userRepository = userRepository;

    options = options || {};
    this.statsChannel = options.statsChannel;
    this.topUnknownsToQuery = options.topUnknownsToQuery;
    this.reportingThreshold = options.reportingThreshold;

    this.directMessageHandler = new DirectMessageHandler(this.userRepository);
  }

  handleConnectedEvent() {
    var botChannel = this.adapter.getChannelByName(this.statsChannel);

    if (botChannel) {
      botChannel.send('I just started up!');
    }
  }

  handleChannelMessage(channel, message) {
    if (this.mustNotLog(message)) { return; }
    this.log.logMessage(message);
  }

  mustNotLog(message) {
    if (this.adapter.getChannel(message.channel).name == this.statsChannel) {
      return true;
    }

    // Message subtypes are listed here:
    // https://api.slack.com/events/message
    var subtypesToLog = [
      'me_message',
      'file_share',
      'file_comment',
      'file_mention'
    ];

    if (message.subtype) {
      return subtypesToLog.indexOf(message.subtype) == -1;
    } else {
      return false;
    }
  }

  handleDirectMessage(channel, message) {
    this.directMessageHandler.handle(channel, message);
  }

  reportChannelStatistics(channelID) {
    var channel = this.adapter.getChannel(channelID);
    var botChannel = this.adapter.getChannelByName(this.statsChannel);
    var statisticsPackage = this.log.getChannelStatistics(channel.id);

    if (!statisticsPackage) {
      return;
    }

    var statistics = statisticsPackage.statistics;
    var metadata = statisticsPackage.metadata;

    var counts = values(statistics);
    var total = counts.reduce(function(total, count) {
      return total + count;
    }, 0);

    if (total < this.reportingThreshold) {
      return;
    } else {
      this.log.resetChannelStatistics(channel.id);
    }

    var isManExtractor = new RepositoryAttributeExtractor(this.userRepository, 'isMan', Object.keys(statistics));

    isManExtractor.extract().then(function(userIsMan) {
      requestUnknownSelfIdentification({
        statistics: statistics,
        userRepository: this.userRepository,
        userIsMan: userIsMan,
        adapter: this.adapter,
        count: this.topUnknownsToQuery
      });

      var isPersonOfColourExtractor = new RepositoryAttributeExtractor(this.userRepository, 'isPersonOfColour', Object.keys(statistics));

      isPersonOfColourExtractor.extract().then(function(userIsPersonOfColour) {
        var preamble = `#${channel.name} since ${moment(metadata.startTime).fromNow()}`;
        var fullReport = new VerboseGenderReportGenerator(statistics, userIsMan, metadata.startTime, channel.name).generate();
        botChannel.send(`${preamble}:\n${fullReport}`);

        var terseReport = new TerseReportGenerator(statistics, userIsMan, userIsPersonOfColour, metadata.startTime, botChannel.name).generate();
        channel.send(terseReport);
      });
    }.bind(this));
  }

  reportAllChannelStatistics() {
    for (let channelID of this.log.getChannels()) {
      this.reportChannelStatistics(channelID);
    }
  }
}

module.exports = StatsBot
