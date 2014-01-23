var get = Ember.get, set = Ember.set;
var Person, Company, store, adapter, container;
var Promise = Ember.RSVP.Promise;

var  PEOPLE_FIXTURES= {
  1: { id: 1, firstName: 'Braaaahm' },
  2: { id: 2, firstName: 'mhaaaarb' }
};

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
  unsubscribe: function(store, record) {
    var type = record.constructor.typeKey;
    var service = this.serviceFor(type);
    service.unsubscribe(type, record.get('id'));
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
    this._subscribers = 0;
    this._super();
  },
  update: function(type, payload) {
    this.trigger('update', type, payload);
  },
  subscribe: function(type, id, callback){
    this.incrementProperty(type + id);
    this.on('update', callback);
  },
  unsubscribe: function(type, id){
    if (!this.decrementProperty(type + id)) { return; }

    this.off('update');
  }
});

DS.Model.reopen({
  subscribe: function(){
    return this.get('store').subscribe(this);
  },
  unsubscribe: function(){
    return this.get('store').unsubscribe(this);
  }
});

DS.Store.reopen({
  subscribe: function(record){
    return this.adapterFor(record).subscribe(this, record);
  },
  unsubscribe: function(record){
    return this.adapterFor(record).unsubscribe(this, record);
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
  expect(6);

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

    equal(get(person1, 'firstName'), 'Yolo',     'person1: firstName should be updated');
    equal(get(person2, 'firstName'), 'mhaaaarb', 'person2: firstName should NOT be updated');

  }).then(function(){
    return Promise.all([
      person2.subscribe(),
      person1.unsubscribe()
    ]);
  }).then(function(){
    Ember.run(function(){ mockService.update('person', { people: [{ id: 2, firstName: 'Abba'} ]}); });

    equal(get(person1, 'firstName'), 'Yolo', 'person1: firstName should NOT be updated');
    equal(get(person2, 'firstName'), 'Abba', 'person2: firstName should be updated');
  })['finally'](start);
});
