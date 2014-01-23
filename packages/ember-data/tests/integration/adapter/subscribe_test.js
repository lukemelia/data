var get = Ember.get, set = Ember.set;
var Person, Company, store, adapter, container;
var Promise = Ember.RSVP.Promise;

function setupStore(options) {
  var env = {};
  options = options || {};

  var container = env.container = new Ember.Container();

  var adapter = env.adapter = (options.adapter || DS.Adapter);
  delete options.adapter;

  for (var prop in options) {
    container.register('model:' + prop, options[prop]);
  }

  container.register('store:main', DS.Store.extend({
    adapter: adapter
  }));

  container.register('serializer:-default', DS.JSONSerializer);
  container.register('serializer:-rest', DS.RESTSerializer);
  container.register('adapter:-rest', DS.RESTAdapter);

  container.injection('serializer', 'store', 'store:main');

  env.serializer = container.lookup('serializer:-default');
  env.store = container.lookup('store:main');

  return env;
}

var  PEOPLE_FIXTURES= {
  1: { id: 1, firstName: 'Braaaahm' },
  2: { id: 2, firstName: 'mhaaaarb' }
};

DS.Adapter.reopen({
  subscribe: Ember.K,
  unsubscribe: Ember.K
});

var Adapter = DS.Adapter.extend({
  init: function(){
    this._super();
    this._services = {};
  },
  willDestroy: function(){
    this._super();
    this.service.off('update');
    this.service = null;
  },
  find: function(store, type, id) {
    return {
      people: PEOPLE_FIXTURES[id]
    };
  },
  subscribe: function(store, record) {
    var type = record.constructor.typeKey;
    var service = this.serviceFor(type);
    service.subscribe(type, record.get('id'), function(type, payload){
      store.pushPayload(type, payload);
    });
  },
  unsubscribe: function(store, record, opts) {
    var type = record.constructor.typeKey;
    var service = this.serviceFor(type);
    service.unsubscribe(type, record.get('id'), opts);
  },
  serviceFor: function(type) {
    var service = this._services[type];
    if (!service) {
      service = this._services[type] = mockService; //TODO: container lookup
      if (!service) { throw new Error('no service found for ' + type); }
    }
    return service;
  }
});

var mockService = Ember.Object.createWithMixins(Ember.Evented, {
  init: function(){
    this._subscribers = Ember.Object.create();
    this._super();
  },
  update: function(type, payload) {
    this.trigger('update', type, payload);
  },
  subscribe: function(type, id, callback){
    this._subscribers.incrementProperty(type + id);
    this.on('update', callback);
  },
  unsubscribe: function(type, id, opts){
    if (opts && opts.force) {
       this._subscribers.set(type + id, 0);
    } else {
      var subscriberCount = this._subscribers.decrementProperty(type + id);
      Ember.assert("attempted to unsubscribe from " + type + ', ' + id + ' but it was not subscribed', subscriberCount >= 0);
      if (subscriberCount <= 0) {
       this._subscribers.set(type + id, 0);
      }
    }
    if (this._subscribers.get([type+id]) === 0) {
       // TODO: turn off polling
    }
  },
  isSubscribedTo: function(type, id) {
    return this._subscribers[type + id] > 0;
  }
});

DS.Model.reopen({
  subscribe: function(){
    return this.get('store').subscribe(this);
  },
  unsubscribe: function(opts){
    return this.get('store').unsubscribe(this, opts);
  },
  willDestroy: function() {
    this.unsubscribe({ force: true });
    this._super();
  }
});

DS.Store.reopen({
  subscribe: function(record){
    return this.adapterFor(record).subscribe(this, record);
  },
  unsubscribe: function(record, opts){
    return this.adapterFor(record).unsubscribe(this, record, opts);
  },
  dematerializeRecord: function(record) {
    this.unsubscribe(record, { force: true });
    this._super(record);
  }
});

module('integration/adapter/subscribe - Finding and Subscribing to Records', {
  setup: function() {
    Person = DS.Model.extend({
      typeKey: 'person', // TODO deal with this
      updatedAt: DS.attr('string'),
      firstName: DS.attr('string'),
      lastName: DS.attr('string')
    });
    Company = DS.Model.extend({
      typeKey: 'company', // TODO deal with this
      name: DS.attr('string')
    });
  },
  teardown: function() {
    store.destroy();
  }
});

test("When a single record is requested, the adapter's find method should be called unless it='s loaded.", function() {
  expect(12);

  var env = setupStore({
    person: Person,
    adapter: Adapter
  });

  env.container.register('serializer:person', DS.RESTSerializer);
  store = env.store;
  stop();

  var person1, person2, people;

  Ember.RSVP.hash({
    person1: store.find('person', 1),
    person2: store.find('person', 2)
  }).then(function(people){

    person1 = people.person1;
    person2 = people.person2;

    equal(get(person1, 'firstName'), 'Braaaahm', 'person1: firstName should be set');
    equal(get(person2, 'firstName'), 'mhaaaarb', 'person2: firstName should be set');

    return person1.subscribe();
  }).then(function(){
    Ember.run(function(){ mockService.update('person', { people: [ {id: 1, firstName: 'Yolo'} ]} ); });
    equal(mockService.isSubscribedTo('person', 1), true, "person1: should be subscribed to");
    equal(mockService.isSubscribedTo('person', 2), false, "person2: should NOT subscribed to");
    equal(get(person1, 'firstName'), 'Yolo',     'person1: firstName should be updated');
    equal(get(person2, 'firstName'), 'mhaaaarb', 'person2: firstName should NOT be updated');

  }).then(function(){
    return Promise.all([
      person2.subscribe(),
      person1.unsubscribe()
    ]);
  }).then(function(){
    Ember.run(function(){ mockService.update('person', { people: [{ id: 2, firstName: 'Abba'} ]}); });
    equal(mockService.isSubscribedTo('person', 1), false, "person1: should NOT be subscribed to");
    equal(mockService.isSubscribedTo('person', 2), true, "person2: should be subscribed to");

    equal(get(person1, 'firstName'), 'Yolo', 'person1: firstName should NOT be updated');
    equal(get(person2, 'firstName'), 'Abba', 'person2: firstName should be updated');
  }).then(function(){
    return person1.subscribe();
  }).then(function(){
    Ember.run(function(){
      person1.unloadRecord();
      person2.destroy();
    });
    equal(mockService.isSubscribedTo('person', 1), false, "person1: should NOT be subscribed to");
    equal(mockService.isSubscribedTo('person', 2), false, "person2: should NOT be subscribed to");
  })['finally'](start);
});
